-- Expand Google Place-ID matching into a quota-aware monthly pipeline with
-- durable IDs-only candidate evidence, type-aware Nearby Search, and a separate
-- reverse-geocoding repair lane. Google Maps Platform free usage resets at
-- midnight Pacific time, so billing-month accounting follows America/Los_Angeles.

alter table public.google_places_sku_monthly_usage
  drop constraint if exists google_places_sku_monthly_usage_sku_check;

alter table public.google_places_sku_monthly_usage
  add constraint google_places_sku_monthly_usage_sku_check
  check (sku in (
    'text_search_pro',
    'place_details_pro',
    'place_details_essentials',
    'autocomplete_requests',
    'nearby_search_pro',
    'geocoding'
  ));

comment on table public.google_places_sku_monthly_usage is
  'Service-role-only Pacific billing-month counters for Google matching SKUs with hard no-cost caps.';

create or replace function public.google_places_billing_month_start_v1()
returns date
language sql
stable
security definer
set search_path=public
as $$
  select date_trunc('month',now() at time zone 'America/Los_Angeles')::date
  where coalesce(auth.role()::text,'')='service_role';
$$;

create or replace function public.google_places_next_free_reset_v1()
returns timestamptz
language sql
stable
security definer
set search_path=public
as $$
  select (
    date_trunc('month',now() at time zone 'America/Los_Angeles') + interval '1 month'
  ) at time zone 'America/Los_Angeles'
  where coalesce(auth.role()::text,'')='service_role';
$$;

create or replace function public.reserve_google_places_free_sku_v1(target_sku text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  current_month date := date_trunc('month',now() at time zone 'America/Los_Angeles')::date;
  hard_limit integer;
  used integer;
begin
  if coalesce(auth.role()::text,'') <> 'service_role' then raise exception 'service role required'; end if;
  hard_limit := case target_sku
    when 'text_search_pro' then 5000
    when 'place_details_pro' then 5000
    when 'place_details_essentials' then 10000
    when 'autocomplete_requests' then 10000
    when 'nearby_search_pro' then 5000
    when 'geocoding' then 10000
    else null
  end;
  if hard_limit is null then raise exception 'unsupported Google matching SKU'; end if;

  insert into public.google_places_sku_monthly_usage(month_start,sku)
  values(current_month,target_sku)
  on conflict(month_start,sku) do nothing;

  select requests_used into used
  from public.google_places_sku_monthly_usage
  where month_start=current_month and sku=target_sku
  for update;

  if used>=hard_limit then
    return jsonb_build_object(
      'allowed',false,'sku',target_sku,'monthStart',current_month,
      'used',used,'limit',hard_limit,'remaining',0
    );
  end if;

  update public.google_places_sku_monthly_usage
  set requests_used=requests_used+1,updated_at=now()
  where month_start=current_month and sku=target_sku;

  return jsonb_build_object(
    'allowed',true,'sku',target_sku,'monthStart',current_month,
    'used',used+1,'limit',hard_limit,'remaining',hard_limit-used-1
  );
end;
$$;

create or replace function public.release_google_places_free_sku_v1(target_sku text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  current_month date := date_trunc('month',now() at time zone 'America/Los_Angeles')::date;
  used integer;
begin
  if coalesce(auth.role()::text,'') <> 'service_role' then raise exception 'service role required'; end if;
  if target_sku not in (
    'text_search_pro','place_details_pro','place_details_essentials',
    'autocomplete_requests','nearby_search_pro','geocoding'
  ) then raise exception 'unsupported Google matching SKU'; end if;

  update public.google_places_sku_monthly_usage
  set requests_used=greatest(0,requests_used-1),updated_at=now()
  where month_start=current_month and sku=target_sku
  returning requests_used into used;

  return jsonb_build_object('released',used is not null,'sku',target_sku,'used',coalesce(used,0));
end;
$$;

create or replace function public.google_places_free_sku_usage_v1()
returns table(sku text, requests_used integer, monthly_limit integer, remaining integer)
language sql
stable
security definer
set search_path=public
as $$
  select limits.sku,
    coalesce(usage.requests_used,0)::integer,
    limits.monthly_limit,
    greatest(0,limits.monthly_limit-coalesce(usage.requests_used,0))::integer
  from (values
    ('text_search_pro'::text,5000::integer),
    ('place_details_pro'::text,5000::integer),
    ('place_details_essentials'::text,10000::integer),
    ('autocomplete_requests'::text,10000::integer),
    ('nearby_search_pro'::text,5000::integer),
    ('geocoding'::text,10000::integer)
  ) limits(sku,monthly_limit)
  left join public.google_places_sku_monthly_usage usage
    on usage.sku=limits.sku
   and usage.month_start=date_trunc('month',now() at time zone 'America/Los_Angeles')::date
  where coalesce(auth.role()::text,'')='service_role';
$$;

create table if not exists public.google_place_id_candidates (
  location_id uuid not null references public.locations(id) on delete cascade,
  google_place_id text not null,
  query_variant text not null,
  sightings integer not null default 1 check (sightings > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key(location_id,google_place_id,query_variant),
  check (length(google_place_id) between 3 and 512),
  check (length(query_variant) between 1 and 80)
);

create index if not exists google_place_id_candidates_location_recent_idx
  on public.google_place_id_candidates(location_id,last_seen_at desc);

alter table public.google_place_id_candidates enable row level security;
revoke all on table public.google_place_id_candidates from public,anon,authenticated;
grant select,insert,update,delete on table public.google_place_id_candidates to service_role;

comment on table public.google_place_id_candidates is
  'Service-role-only durable Google Place ID candidate evidence from no-cost IDs-only discovery. No Google name/address content is stored.';

create table if not exists public.google_place_geocode_attempts (
  location_id uuid primary key references public.locations(id) on delete cascade,
  status text not null check (status in ('seeded','no_result','failed','quota_deferred')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  retry_after timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.google_place_geocode_attempts enable row level security;
revoke all on table public.google_place_geocode_attempts from public,anon,authenticated;
grant select,insert,update,delete on table public.google_place_geocode_attempts to service_role;

comment on table public.google_place_geocode_attempts is
  'Tracks reverse-geocoding repair attempts without persisting Google formatted-address content.';

create or replace function public.record_google_place_id_candidate_v1(
  target_location_id uuid,
  target_google_place_id text,
  target_query_variant text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  recorded public.google_place_id_candidates%rowtype;
begin
  if coalesce(auth.role()::text,'') <> 'service_role' then raise exception 'service role required'; end if;
  if nullif(trim(target_google_place_id),'') is null then raise exception 'Google Place ID required'; end if;
  if nullif(trim(target_query_variant),'') is null then raise exception 'query variant required'; end if;

  insert into public.google_place_id_candidates(location_id,google_place_id,query_variant)
  values(target_location_id,trim(target_google_place_id),left(trim(target_query_variant),80))
  on conflict(location_id,google_place_id,query_variant) do update
    set sightings=public.google_place_id_candidates.sightings+1,
        last_seen_at=now()
  returning * into recorded;

  return jsonb_build_object(
    'locationId',recorded.location_id,
    'googlePlaceId',recorded.google_place_id,
    'queryVariant',recorded.query_variant,
    'sightings',recorded.sightings
  );
end;
$$;

create or replace function public.google_place_candidate_ids_v1(
  target_location_id uuid,
  max_candidates integer default 5
)
returns table(
  google_place_id text,
  variant_count integer,
  sightings integer,
  consensus_score numeric
)
language sql
stable
security definer
set search_path=public
as $$
  select candidate.google_place_id,
    count(*)::integer as variant_count,
    sum(candidate.sightings)::integer as sightings,
    least(
      0.99::numeric,
      0.45::numeric +
      least(4,count(*))::numeric * 0.12::numeric +
      least(10,sum(candidate.sightings))::numeric * 0.015::numeric
    ) as consensus_score
  from public.google_place_id_candidates candidate
  where candidate.location_id=target_location_id
    and coalesce(auth.role()::text,'')='service_role'
  group by candidate.google_place_id
  order by variant_count desc,sightings desc,max(candidate.last_seen_at) desc,candidate.google_place_id
  limit greatest(1,least(coalesce(max_candidates,5),10));
$$;

create or replace function public.claim_google_place_discovery_candidates_v1(batch_size integer default 500)
returns table(
  id uuid,
  name text,
  kind text,
  latitude double precision,
  longitude double precision,
  city text,
  region text,
  country text,
  country_code text,
  address_public text
)
language sql
security definer
set search_path=public
as $$
  select location.id,location.name,location.kind,location.latitude,location.longitude,
         location.city,location.region,location.country,location.country_code,location.address_public
  from public.locations location
  left join lateral (
    select max(candidate.last_seen_at) as last_discovered_at
    from public.google_place_id_candidates candidate
    where candidate.location_id=location.id
  ) discovery on true
  where location.status='published' and location.visibility='public'
    and location.latitude is not null and location.longitude is not null
    and not exists(
      select 1 from public.location_google_places mapping
      where mapping.location_id=location.id and mapping.status='verified'
    )
    and not exists(
      select 1 from public.location_photo_sources photo
      where photo.location_id=location.id and photo.status='approved' and photo.is_ai_generated is not true
    )
  order by discovery.last_discovered_at asc nulls first,location.published_at desc nulls last,location.id
  limit greatest(1,least(coalesce(batch_size,500),5000));
$$;

create or replace function public.claim_google_place_geocode_candidates_v1(batch_size integer default 500)
returns table(
  id uuid,
  name text,
  kind text,
  latitude double precision,
  longitude double precision,
  city text,
  region text,
  country text,
  country_code text,
  attempt_count integer
)
language sql
security definer
set search_path=public
as $$
  select location.id,location.name,location.kind,location.latitude,location.longitude,
         location.city,location.region,location.country,location.country_code,
         coalesce(attempt.attempt_count,0)
  from public.locations location
  left join public.google_place_geocode_attempts attempt on attempt.location_id=location.id
  where location.status='published' and location.visibility='public'
    and location.latitude is not null and location.longitude is not null
    and nullif(trim(coalesce(location.address_public,'')),'') is null
    and not exists(
      select 1 from public.location_google_places mapping
      where mapping.location_id=location.id and mapping.status='verified'
    )
    and not exists(
      select 1 from public.location_photo_sources photo
      where photo.location_id=location.id and photo.status='approved' and photo.is_ai_generated is not true
    )
    and (attempt.retry_after is null or attempt.retry_after<=now())
  order by attempt.last_attempt_at asc nulls first,location.published_at desc nulls last,location.id
  limit greatest(1,least(coalesce(batch_size,500),5000));
$$;

create or replace function public.claim_google_place_candidates_v3(batch_size integer default 100)
returns table(
  id uuid,
  name text,
  kind text,
  latitude double precision,
  longitude double precision,
  city text,
  region text,
  country text,
  country_code text,
  address_public text,
  attempt_count integer,
  candidate_place_ids text[],
  candidate_consensus numeric
)
language sql
security definer
set search_path=public
as $$
  select location.id,location.name,location.kind,location.latitude,location.longitude,
         location.city,location.region,location.country,location.country_code,location.address_public,
         coalesce(attempt.attempt_count,0),
         coalesce(evidence.candidate_place_ids,'{}'::text[]),
         coalesce(evidence.candidate_consensus,0::numeric)
  from public.locations location
  left join public.google_place_match_attempts attempt on attempt.location_id=location.id
  left join public.static_catalogue_materializations materialization on materialization.location_id=location.id
  left join lateral (
    select array_agg(ranked.google_place_id order by ranked.variant_count desc,ranked.sightings desc) as candidate_place_ids,
      max(ranked.consensus_score) as candidate_consensus
    from (
      select candidate.google_place_id,
        count(*)::integer as variant_count,
        sum(candidate.sightings)::integer as sightings,
        least(
          0.99::numeric,
          0.45::numeric + least(4,count(*))::numeric * 0.12::numeric +
          least(10,sum(candidate.sightings))::numeric * 0.015::numeric
        ) as consensus_score
      from public.google_place_id_candidates candidate
      where candidate.location_id=location.id
      group by candidate.google_place_id
      order by variant_count desc,sightings desc,max(candidate.last_seen_at) desc
      limit 5
    ) ranked
  ) evidence on true
  where location.status='published' and location.visibility='public'
    and location.latitude is not null and location.longitude is not null
    and not exists(
      select 1 from public.location_google_places mapping
      where mapping.location_id=location.id and mapping.status='verified'
    )
    and not exists(
      select 1 from public.location_photo_sources photo
      where photo.location_id=location.id and photo.status='approved' and photo.is_ai_generated is not true
    )
    and (attempt.retry_after is null or attempt.retry_after<=now())
  order by coalesce(evidence.candidate_consensus,0) desc,
           coalesce(attempt.attempt_count,0) asc,
           coalesce(materialization.last_touched_at,location.published_at) desc nulls last,
           location.id
  limit greatest(1,least(coalesce(batch_size,100),5000));
$$;

revoke all on function public.google_places_billing_month_start_v1() from public,anon,authenticated;
revoke all on function public.google_places_next_free_reset_v1() from public,anon,authenticated;
revoke all on function public.reserve_google_places_free_sku_v1(text) from public,anon,authenticated;
revoke all on function public.release_google_places_free_sku_v1(text) from public,anon,authenticated;
revoke all on function public.google_places_free_sku_usage_v1() from public,anon,authenticated;
revoke all on function public.record_google_place_id_candidate_v1(uuid,text,text) from public,anon,authenticated;
revoke all on function public.google_place_candidate_ids_v1(uuid,integer) from public,anon,authenticated;
revoke all on function public.claim_google_place_discovery_candidates_v1(integer) from public,anon,authenticated;
revoke all on function public.claim_google_place_geocode_candidates_v1(integer) from public,anon,authenticated;
revoke all on function public.claim_google_place_candidates_v3(integer) from public,anon,authenticated;

grant execute on function public.google_places_billing_month_start_v1() to service_role;
grant execute on function public.google_places_next_free_reset_v1() to service_role;
grant execute on function public.reserve_google_places_free_sku_v1(text) to service_role;
grant execute on function public.release_google_places_free_sku_v1(text) to service_role;
grant execute on function public.google_places_free_sku_usage_v1() to service_role;
grant execute on function public.record_google_place_id_candidate_v1(uuid,text,text) to service_role;
grant execute on function public.google_place_candidate_ids_v1(uuid,integer) to service_role;
grant execute on function public.claim_google_place_discovery_candidates_v1(integer) to service_role;
grant execute on function public.claim_google_place_geocode_candidates_v1(integer) to service_role;
grant execute on function public.claim_google_place_candidates_v3(integer) to service_role;
