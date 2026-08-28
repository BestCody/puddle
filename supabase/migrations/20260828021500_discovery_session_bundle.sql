-- Bundle the authenticated discovery session reads into one database round trip.
-- The profile and seen IDs are both request-scoped; no private response is cached.

-- The latest-swipe branch is the only potentially high-cardinality part of the
-- session read. Match its DISTINCT ON ordering so history stays bounded by the
-- requesting profile instead of sorting that user's full action history.
create index if not exists discovery_actions_profile_location_latest_idx
  on public.discovery_actions(profile_id, location_id, id desc)
  include (undone_at)
  where location_id is not null
    and action in ('saved','interested','dismissed','visited');

create or replace function public.discovery_session_v1()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with actor as (
    select auth.uid() as id
  ), latest_swipe as (
    select distinct on (action.location_id)
      action.location_id,
      action.undone_at
    from public.discovery_actions action
    where action.profile_id=(select actor.id from actor)
      and action.location_id is not null
      and action.action in ('saved','interested','dismissed','visited')
    order by action.location_id,action.id desc
  ), seen_ids as (
    select latest.location_id
    from latest_swipe latest
    where latest.undone_at is null

    union

    select state.location_id
    from public.user_content_states state
    where state.profile_id=(select actor.id from actor)
      and state.location_id is not null
      and state.state in ('saved','interested','visited')
  )
  select jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'latitude', profile.latitude,
        'longitude', profile.longitude,
        'search_radius_km', profile.search_radius_km,
        'interests', profile.interests,
        'location_label', profile.location_label,
        'city', profile.city,
        'suspended_at', profile.suspended_at,
        'banned_at', profile.banned_at
      )
      from public.profiles profile
      where profile.id=(select actor.id from actor)
    ),
    'seen_location_ids', coalesce(
      (
        select jsonb_agg(to_jsonb(seen.location_id) order by seen.location_id)
        from seen_ids seen
      ),
      '[]'::jsonb
    )
  )
  where (select actor.id from actor) is not null;
$$;

revoke all on function public.discovery_session_v1() from public,anon;
grant execute on function public.discovery_session_v1() to authenticated,service_role;
