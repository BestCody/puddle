-- Progressive open-photo enrichment: prioritize locations already entering swipe decks,
-- then locations near recently active users, while keeping claims bounded and resumable.

create index if not exists recommendation_candidates_recent_location_idx
  on public.recommendation_candidates(location_id,created_at desc)
  where content_kind='place' and location_id is not null;

create index if not exists recommendation_requests_recent_activity_idx
  on public.recommendation_requests(created_at desc,profile_id);

create or replace function public.claim_open_photo_candidates_v1(
  batch_size integer default 500,
  target_region uuid default null
)
returns table(id uuid,name text,kind text,latitude double precision,longitude double precision)
language plpgsql
security definer
set search_path=public
as $$
begin
  return query
  with recent_deck_locations as (
    select candidate.location_id,max(candidate.created_at) as last_deck_at,
      min(candidate.rank_position) as best_recent_rank
    from public.recommendation_candidates candidate
    where candidate.content_kind='place'
      and candidate.location_id is not null
      and candidate.created_at>=now()-interval '14 days'
    group by candidate.location_id
  ), active_profiles as (
    select distinct profile.id,profile.latitude,profile.longitude
    from public.recommendation_requests request
    join public.profiles profile on profile.id=request.profile_id
    where request.created_at>=now()-interval '30 days'
      and profile.latitude is not null and profile.longitude is not null
  ), near_active_locations as (
    select distinct location.id as location_id
    from active_profiles profile
    join public.locations location
      on location.point is not null
      and st_dwithin(
        location.point,
        st_setsrid(st_makepoint(profile.longitude,profile.latitude),4326)::geography,
        50000
      )
    where location.status='published' and location.visibility='public'
      and not coalesce(location.has_private_address,false)
  ), candidates as (
    select location.id
    from public.locations location
    left join recent_deck_locations deck on deck.location_id=location.id
    left join near_active_locations nearby on nearby.location_id=location.id
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
    order by
      case when deck.location_id is not null then 0 when nearby.location_id is not null then 1 else 2 end,
      deck.last_deck_at desc nulls last,
      deck.best_recent_rank asc nulls last,
      location.photo_attempts asc,
      location.category_confidence desc nulls last,
      location.published_at desc nulls last,
      location.id
    limit greatest(1,least(coalesce(batch_size,500),5000))
    for update of location skip locked
  ), claimed as (
    update public.locations location
    set photo_enrichment_status='processing',photo_last_attempt_at=now(),
        photo_attempts=location.photo_attempts+1,photo_error_message=null,updated_at=now()
    from candidates where location.id=candidates.id
    returning location.id,location.name,location.kind,location.latitude,location.longitude
  )
  select claimed.id,claimed.name,claimed.kind,claimed.latitude,claimed.longitude from claimed;
end;
$$;

revoke all on function public.claim_open_photo_candidates_v1(integer,uuid) from public,anon,authenticated;
grant execute on function public.claim_open_photo_candidates_v1(integer,uuid) to service_role;

comment on function public.claim_open_photo_candidates_v1(integer,uuid) is
  'Claims a bounded open-photo batch, prioritizing recent swipe-deck locations and places near recently active users.';
