-- Harden progressive open-photo enrichment for production-scale catalogues.
-- Keep provider failures retryable, bound expensive prioritization work, and
-- allow the normalized JPEG files produced by the importer.

update storage.buckets as bucket
set allowed_mime_types = case
  when bucket.allowed_mime_types is null then null
  else (
    select array_agg(distinct mime.value order by mime.value)
    from unnest(
      bucket.allowed_mime_types
      || array['image/jpeg','image/png','image/webp','image/avif']::text[]
    ) as mime(value)
  )
end
where bucket.id='puddle-public-media';

create index if not exists locations_open_photo_queue_idx
  on public.locations(photo_attempts,published_at desc,id)
  where status='published'
    and visibility='public'
    and not coalesce(has_private_address,false)
    and latitude is not null
    and longitude is not null
    and photo_enrichment_status in ('pending','failed','no_match','processing');

create index if not exists locations_open_photo_point_idx
  on public.locations using gist(point)
  where status='published'
    and visibility='public'
    and not coalesce(has_private_address,false)
    and point is not null;

create index if not exists recommendation_candidates_photo_recent_idx
  on public.recommendation_candidates(created_at desc,location_id,rank_position)
  where content_kind='place' and location_id is not null;

create or replace function public.claim_open_photo_candidates_v1(
  batch_size integer default 500,
  target_region uuid default null
)
returns table(id uuid,name text,kind text,latitude double precision,longitude double precision)
language plpgsql
security definer
set search_path=public
as $$
declare
  safe_batch integer := greatest(1,least(coalesce(batch_size,500),5000));
  pool_limit integer := least(5000,greatest(500,greatest(1,least(coalesce(batch_size,500),5000))*20));
begin
  return query
  with recent_deck_rows as materialized (
    select candidate.location_id,candidate.created_at,candidate.rank_position
    from public.recommendation_candidates candidate
    where candidate.content_kind='place'
      and candidate.location_id is not null
      and candidate.created_at>=now()-interval '14 days'
    order by candidate.created_at desc
    limit 10000
  ), recent_deck_locations as materialized (
    select recent.location_id,max(recent.created_at) as last_deck_at,
      min(recent.rank_position) as best_recent_rank
    from recent_deck_rows recent
    group by recent.location_id
  ), deck_candidates as materialized (
    select location.id,0 as priority,deck.last_deck_at,deck.best_recent_rank,
      location.photo_attempts,location.category_confidence,location.published_at
    from recent_deck_locations deck
    join public.locations location on location.id=deck.location_id
    where location.status='published' and location.visibility='public'
      and not coalesce(location.has_private_address,false)
      and location.latitude is not null and location.longitude is not null
      and (
        location.photo_enrichment_status in ('pending','failed','no_match')
        or (
          location.photo_enrichment_status='processing'
          and location.photo_last_attempt_at<now()-interval '2 hours'
        )
      )
      and (location.photo_retry_after is null or location.photo_retry_after<=now())
      and (target_region is null or exists(
        select 1 from public.catalogue_region_locations membership
        where membership.region_id=target_region and membership.location_id=location.id
          and membership.present_in_latest_release
      ))
      and not exists(
        select 1 from public.location_photo_sources photo
        where photo.location_id=location.id and photo.status='approved'
          and not coalesce(photo.is_ai_generated,false)
      )
    order by deck.last_deck_at desc,deck.best_recent_rank asc nulls last,
      location.photo_attempts asc,location.category_confidence desc nulls last,
      location.published_at desc nulls last,location.id
    limit safe_batch
  ), fallback_pool as materialized (
    select location.id,location.point,location.photo_attempts,
      location.category_confidence,location.published_at
    from public.locations location
    where location.status='published' and location.visibility='public'
      and not coalesce(location.has_private_address,false)
      and location.latitude is not null and location.longitude is not null
      and (
        location.photo_enrichment_status in ('pending','failed','no_match')
        or (
          location.photo_enrichment_status='processing'
          and location.photo_last_attempt_at<now()-interval '2 hours'
        )
      )
      and (location.photo_retry_after is null or location.photo_retry_after<=now())
      and (target_region is null or exists(
        select 1 from public.catalogue_region_locations membership
        where membership.region_id=target_region and membership.location_id=location.id
          and membership.present_in_latest_release
      ))
      and not exists(
        select 1 from public.location_photo_sources photo
        where photo.location_id=location.id and photo.status='approved'
          and not coalesce(photo.is_ai_generated,false)
      )
      and not exists(select 1 from deck_candidates deck where deck.id=location.id)
    order by location.photo_attempts asc,location.category_confidence desc nulls last,
      location.published_at desc nulls last,location.id
    limit pool_limit
  ), recent_request_rows as materialized (
    select request.profile_id,request.created_at
    from public.recommendation_requests request
    where request.profile_id is not null
      and request.created_at>=now()-interval '30 days'
    order by request.created_at desc
    limit 5000
  ), active_profiles as materialized (
    select distinct on (profile.id)
      profile.id,profile.latitude,profile.longitude,request.created_at as last_active
    from recent_request_rows request
    join public.profiles profile on profile.id=request.profile_id
    where profile.latitude is not null and profile.longitude is not null
    order by profile.id,request.created_at desc
  ), active_profiles_ranked as materialized (
    select profile.id,profile.latitude,profile.longitude,profile.last_active
    from active_profiles profile
    order by profile.last_active desc
    limit 250
  ), prioritized as (
    select deck.id,deck.priority,deck.last_deck_at,deck.best_recent_rank,
      null::timestamptz as last_active,null::double precision as distance_m,
      deck.photo_attempts,deck.category_confidence,deck.published_at
    from deck_candidates deck
    union all
    select pool.id,
      case when nearby.last_active is null then 2 else 1 end as priority,
      null::timestamptz as last_deck_at,null::integer as best_recent_rank,
      nearby.last_active,nearby.distance_m,pool.photo_attempts,
      pool.category_confidence,pool.published_at
    from fallback_pool pool
    left join lateral (
      select profile.last_active,
        st_distance(
          pool.point,
          st_setsrid(st_makepoint(profile.longitude,profile.latitude),4326)::geography
        ) as distance_m
      from active_profiles_ranked profile
      where pool.point is not null
        and st_dwithin(
          pool.point,
          st_setsrid(st_makepoint(profile.longitude,profile.latitude),4326)::geography,
          50000
        )
      order by profile.last_active desc,distance_m asc
      limit 1
    ) nearby on true
  ), lockable as (
    select location.id
    from prioritized candidate
    join public.locations location on location.id=candidate.id
    order by candidate.priority,candidate.last_deck_at desc nulls last,
      candidate.best_recent_rank asc nulls last,candidate.last_active desc nulls last,
      candidate.distance_m asc nulls last,candidate.photo_attempts asc,
      candidate.category_confidence desc nulls last,candidate.published_at desc nulls last,
      candidate.id
    limit safe_batch
    for update of location skip locked
  ), claimed as (
    update public.locations location
    set photo_enrichment_status='processing',photo_last_attempt_at=now(),
      photo_attempts=location.photo_attempts+1,photo_error_message=null,updated_at=now()
    from lockable
    where location.id=lockable.id
    returning location.id,location.name,location.kind,location.latitude,location.longitude
  )
  select claimed.id,claimed.name,claimed.kind,claimed.latitude,claimed.longitude
  from claimed;
end;
$$;

revoke all on function public.claim_open_photo_candidates_v1(integer,uuid) from public,anon,authenticated;
grant execute on function public.claim_open_photo_candidates_v1(integer,uuid) to service_role;

comment on function public.claim_open_photo_candidates_v1(integer,uuid) is
  'Claims a bounded open-photo batch using bounded recent activity windows, recent deck priority, and resumable row locking.';

-- The first production run encountered provider throttling, stale KartaView assets,
-- and a bucket MIME mismatch. Make those known transient failures immediately eligible
-- after this migration instead of waiting through their old retry windows.
update public.locations
set photo_enrichment_status='pending',
  photo_retry_after=now(),
  photo_error_message=null,
  photo_attempts=greatest(photo_attempts-1,0),
  updated_at=now()
where photo_enrichment_status='failed'
  and (
    photo_error_message ilike '%photo providers failed%'
    or photo_error_message ilike '%mime type image/jpeg is not supported%'
    or photo_error_message ilike '%returned 404%'
    or photo_error_message ilike '%returned 429%'
  );
