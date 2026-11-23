-- Discovery loaded a user's entire seen history (every non-undone swipe plus
-- saved, interested and visited places) on every feed request through
-- discovery_session_v1 and discovery_seen_locations_v1, so requests grew slower
-- for the most active users. The feed now reads the profile alone and asks
-- which of the candidate places it is about to show have been seen.
-- The v1 functions remain for app instances still running the previous release.

create or replace function public.discovery_session_v2()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
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
      where profile.id=auth.uid()
    )
  )
  where auth.uid() is not null;
$$;

-- Same seen semantics as discovery_session_v1: the latest non-undone swipe per
-- place, plus saved, interested and visited places. Input is capped at 2,000
-- IDs; both lookups use (profile_id, location_id) indexes.
create or replace function public.discovery_seen_among_v1(candidate_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path=public
as $$
  with actor as (
    select auth.uid() as id
  ), requested as (
    select distinct candidate.location_id
    from unnest((coalesce(candidate_ids, '{}'::uuid[]))[1:2000]) as candidate(location_id)
    where candidate.location_id is not null
  ), latest_swipe as (
    select distinct on (action.location_id)
      action.location_id,
      action.undone_at
    from public.discovery_actions action
    join requested on requested.location_id=action.location_id
    where action.profile_id=(select actor.id from actor)
      and action.action in ('saved','interested','dismissed','visited')
    order by action.location_id,action.id desc
  ), seen as (
    select latest.location_id
    from latest_swipe latest
    where latest.undone_at is null

    union

    select state.location_id
    from public.user_content_states state
    join requested on requested.location_id=state.location_id
    where state.profile_id=(select actor.id from actor)
      and state.state in ('saved','interested','visited')
  )
  select coalesce(array_agg(seen.location_id order by seen.location_id), '{}'::uuid[])
  from seen
  where (select actor.id from actor) is not null;
$$;

revoke all on function public.discovery_session_v2() from public,anon;
grant execute on function public.discovery_session_v2() to authenticated,service_role;
revoke all on function public.discovery_seen_among_v1(uuid[]) from public,anon;
grant execute on function public.discovery_seen_among_v1(uuid[]) to authenticated,service_role;
