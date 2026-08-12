-- Keep Google Place matching claim RPCs comfortably below PostgREST's service-role
-- statement timeout as the catalogue and durable candidate-evidence tables grow.
--
-- The previous rich matcher evaluated candidate evidence with a lateral aggregate
-- once for every eligible location and encouraged a merge-join plan that heap-fetched
-- the full locations table before LIMIT. Materialize narrow queue keys first, aggregate
-- candidate evidence once, select only the requested IDs, then fetch full location rows.

create index if not exists locations_google_place_match_queue_idx
  on public.locations(published_at desc,id)
  where status='published'
    and visibility='public'
    and latitude is not null
    and longitude is not null;

create index if not exists locations_google_place_geocode_queue_idx
  on public.locations(published_at desc,id)
  where status='published'
    and visibility='public'
    and latitude is not null
    and longitude is not null
    and nullif(trim(coalesce(address_public,'')),'') is null;

create index if not exists location_google_places_verified_location_idx
  on public.location_google_places(location_id)
  where status='verified';

create index if not exists location_photo_sources_approved_real_location_idx
  on public.location_photo_sources(location_id)
  where status='approved' and is_ai_generated is not true;

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
  with base as materialized (
    select location.id,location.published_at
    from public.locations location
    where location.status='published'
      and location.visibility='public'
      and location.latitude is not null
      and location.longitude is not null
  ), candidate_grouped as materialized (
    select candidate.location_id,
           candidate.google_place_id,
           count(*)::integer as variant_count,
           sum(candidate.sightings)::integer as sightings,
           max(candidate.last_seen_at) as last_seen_at
    from public.google_place_id_candidates candidate
    group by candidate.location_id,candidate.google_place_id
  ), candidate_ranked as materialized (
    select candidate_grouped.location_id,
           candidate_grouped.google_place_id,
           candidate_grouped.variant_count,
           candidate_grouped.sightings,
           candidate_grouped.last_seen_at,
           least(
             0.99::numeric,
             0.45::numeric +
             least(4,candidate_grouped.variant_count)::numeric * 0.12::numeric +
             least(10,candidate_grouped.sightings)::numeric * 0.015::numeric
           ) as consensus_score,
           row_number() over (
             partition by candidate_grouped.location_id
             order by candidate_grouped.variant_count desc,
                      candidate_grouped.sightings desc,
                      candidate_grouped.last_seen_at desc,
                      candidate_grouped.google_place_id
           ) as candidate_rank
    from candidate_grouped
  ), evidence as materialized (
    select candidate_ranked.location_id,
           array_agg(
             candidate_ranked.google_place_id
             order by candidate_ranked.variant_count desc,
                      candidate_ranked.sightings desc,
                      candidate_ranked.last_seen_at desc,
                      candidate_ranked.google_place_id
           ) as candidate_place_ids,
           max(candidate_ranked.consensus_score) as candidate_consensus
    from candidate_ranked
    where candidate_ranked.candidate_rank<=5
    group by candidate_ranked.location_id
  ), selected as materialized (
    select base.id,
           coalesce(attempt.attempt_count,0) as attempt_count,
           coalesce(evidence.candidate_place_ids,'{}'::text[]) as candidate_place_ids,
           coalesce(evidence.candidate_consensus,0::numeric) as candidate_consensus,
           case when attempt.location_id is null then 0 else 1 end as attempted_sort,
           coalesce(materialization.last_touched_at,base.published_at) as touched_sort
    from base
    left join public.google_place_match_attempts attempt on attempt.location_id=base.id
    left join public.static_catalogue_materializations materialization on materialization.location_id=base.id
    left join evidence on evidence.location_id=base.id
    where not exists(
      select 1 from public.location_google_places mapping
      where mapping.location_id=base.id and mapping.status='verified'
    )
      and not exists(
        select 1 from public.location_photo_sources photo
        where photo.location_id=base.id
          and photo.status='approved'
          and photo.is_ai_generated is not true
      )
      and (
        attempt.location_id is null
        or attempt.retry_after is null
        or attempt.retry_after<=now()
        or (
          attempt.status='no_match'
          and attempt.last_attempt_at is not null
          and attempt.last_attempt_at<=now()-interval '6 hours'
        )
      )
    order by coalesce(evidence.candidate_consensus,0) desc,
             case when attempt.location_id is null then 0 else 1 end,
             coalesce(attempt.attempt_count,0) asc,
             coalesce(materialization.last_touched_at,base.published_at) desc nulls last,
             base.id
    limit greatest(1,least(coalesce(batch_size,100),5000))
  )
  select location.id,
         location.name,
         location.kind,
         location.latitude,
         location.longitude,
         location.city,
         location.region,
         location.country,
         location.country_code,
         location.address_public,
         selected.attempt_count,
         selected.candidate_place_ids,
         selected.candidate_consensus
  from selected
  join public.locations location on location.id=selected.id
  order by selected.candidate_consensus desc,
           selected.attempted_sort,
           selected.attempt_count,
           selected.touched_sort desc nulls last,
           selected.id;
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
  with base as materialized (
    select location.id,location.published_at
    from public.locations location
    where location.status='published'
      and location.visibility='public'
      and location.latitude is not null
      and location.longitude is not null
  ), discovery as materialized (
    select candidate.location_id,max(candidate.last_seen_at) as last_discovered_at
    from public.google_place_id_candidates candidate
    group by candidate.location_id
  ), selected as materialized (
    select base.id,discovery.last_discovered_at,base.published_at
    from base
    left join discovery on discovery.location_id=base.id
    where not exists(
      select 1 from public.location_google_places mapping
      where mapping.location_id=base.id and mapping.status='verified'
    )
      and not exists(
        select 1 from public.location_photo_sources photo
        where photo.location_id=base.id
          and photo.status='approved'
          and photo.is_ai_generated is not true
      )
    order by discovery.last_discovered_at asc nulls first,
             base.published_at desc nulls last,
             base.id
    limit greatest(1,least(coalesce(batch_size,500),5000))
  )
  select location.id,
         location.name,
         location.kind,
         location.latitude,
         location.longitude,
         location.city,
         location.region,
         location.country,
         location.country_code,
         location.address_public
  from selected
  join public.locations location on location.id=selected.id
  order by selected.last_discovered_at asc nulls first,
           selected.published_at desc nulls last,
           selected.id;
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
  with base as materialized (
    select location.id,location.published_at
    from public.locations location
    where location.status='published'
      and location.visibility='public'
      and location.latitude is not null
      and location.longitude is not null
      and nullif(trim(coalesce(location.address_public,'')),'') is null
  ), selected as materialized (
    select base.id,
           coalesce(attempt.attempt_count,0) as attempt_count,
           attempt.last_attempt_at,
           base.published_at
    from base
    left join public.google_place_geocode_attempts attempt on attempt.location_id=base.id
    where not exists(
      select 1 from public.location_google_places mapping
      where mapping.location_id=base.id and mapping.status='verified'
    )
      and not exists(
        select 1 from public.location_photo_sources photo
        where photo.location_id=base.id
          and photo.status='approved'
          and photo.is_ai_generated is not true
      )
      and (attempt.retry_after is null or attempt.retry_after<=now())
    order by attempt.last_attempt_at asc nulls first,
             base.published_at desc nulls last,
             base.id
    limit greatest(1,least(coalesce(batch_size,500),5000))
  )
  select location.id,
         location.name,
         location.kind,
         location.latitude,
         location.longitude,
         location.city,
         location.region,
         location.country,
         location.country_code,
         selected.attempt_count
  from selected
  join public.locations location on location.id=selected.id
  order by selected.last_attempt_at asc nulls first,
           selected.published_at desc nulls last,
           selected.id;
$$;

revoke all on function public.claim_google_place_candidates_v3(integer) from public,anon,authenticated;
revoke all on function public.claim_google_place_discovery_candidates_v1(integer) from public,anon,authenticated;
revoke all on function public.claim_google_place_geocode_candidates_v1(integer) from public,anon,authenticated;

grant execute on function public.claim_google_place_candidates_v3(integer) to service_role;
grant execute on function public.claim_google_place_discovery_candidates_v1(integer) to service_role;
grant execute on function public.claim_google_place_geocode_candidates_v1(integer) to service_role;
