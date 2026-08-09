-- Use each Google Places monthly no-cost SKU allowance deliberately without
-- coupling catalogue matching to the separate runtime photo-delivery budget.

create table if not exists public.google_places_sku_monthly_usage (
  month_start date not null,
  sku text not null check (sku in (
    'text_search_pro',
    'place_details_pro',
    'place_details_essentials'
  )),
  requests_used integer not null default 0 check (requests_used >= 0),
  updated_at timestamptz not null default now(),
  primary key (month_start, sku)
);

alter table public.google_places_sku_monthly_usage enable row level security;
revoke all on table public.google_places_sku_monthly_usage from public,anon,authenticated;
grant select,insert,update,delete on table public.google_places_sku_monthly_usage to service_role;

comment on table public.google_places_sku_monthly_usage is
  'Service-role-only UTC monthly counters for Google Places matching SKUs with hard no-cost caps.';

create or replace function public.reserve_google_places_free_sku_v1(target_sku text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  current_month date := date_trunc('month',now() at time zone 'UTC')::date;
  hard_limit integer;
  used integer;
begin
  if coalesce(auth.role()::text,'') <> 'service_role' then raise exception 'service role required'; end if;
  hard_limit := case target_sku
    when 'text_search_pro' then 5000
    when 'place_details_pro' then 5000
    when 'place_details_essentials' then 10000
    else null
  end;
  if hard_limit is null then raise exception 'unsupported Google Places SKU'; end if;

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
  current_month date := date_trunc('month',now() at time zone 'UTC')::date;
  used integer;
begin
  if coalesce(auth.role()::text,'') <> 'service_role' then raise exception 'service role required'; end if;
  if target_sku not in ('text_search_pro','place_details_pro','place_details_essentials') then
    raise exception 'unsupported Google Places SKU';
  end if;

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
    ('place_details_essentials'::text,10000::integer)
  ) limits(sku,monthly_limit)
  left join public.google_places_sku_monthly_usage usage
    on usage.sku=limits.sku
   and usage.month_start=date_trunc('month',now() at time zone 'UTC')::date
  where coalesce(auth.role()::text,'')='service_role';
$$;

-- V2 preserves the V1 candidate semantics, exposes the public address needed for
-- strict Essentials-only verification, and raises the worker claim ceiling for
-- fast initial catalogue backfill.
create or replace function public.claim_google_place_candidates_v2(batch_size integer default 100)
returns table(
  id uuid,
  name text,
  latitude double precision,
  longitude double precision,
  city text,
  region text,
  country text,
  country_code text,
  address_public text,
  attempt_count integer
)
language sql
security definer
set search_path=public
as $$
  select location.id,location.name,location.latitude,location.longitude,location.city,location.region,
         location.country,location.country_code,location.address_public,coalesce(attempt.attempt_count,0)
  from public.locations location
  left join public.google_place_match_attempts attempt on attempt.location_id=location.id
  left join public.static_catalogue_materializations materialization on materialization.location_id=location.id
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
  order by coalesce(materialization.last_touched_at,location.published_at) desc nulls last,
           coalesce(attempt.attempt_count,0) asc,
           location.id
  limit greatest(1,least(coalesce(batch_size,100),5000));
$$;

alter table public.google_place_match_attempts
  drop constraint if exists google_place_match_attempts_status_check;
alter table public.google_place_match_attempts
  add constraint google_place_match_attempts_status_check
  check (status in ('no_match','failed','quota_deferred'));

revoke all on function public.reserve_google_places_free_sku_v1(text) from public,anon,authenticated;
revoke all on function public.release_google_places_free_sku_v1(text) from public,anon,authenticated;
revoke all on function public.google_places_free_sku_usage_v1() from public,anon,authenticated;
revoke all on function public.claim_google_place_candidates_v2(integer) from public,anon,authenticated;
grant execute on function public.reserve_google_places_free_sku_v1(text) to service_role;
grant execute on function public.release_google_places_free_sku_v1(text) to service_role;
grant execute on function public.google_places_free_sku_usage_v1() to service_role;
grant execute on function public.claim_google_place_candidates_v2(integer) to service_role;
