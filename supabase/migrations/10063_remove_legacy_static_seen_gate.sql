-- Discovery seen-history is fully relational. Legacy static-catalogue actions must
-- not suppress relational locations after the cutover.

create or replace function public.discovery_seen_locations_v1()
returns table(
  id uuid,
  duplicate_group_key text,
  catalogue_group_key text,
  name text,
  latitude double precision,
  longitude double precision
)
language sql
stable
security definer
set search_path=public
as $$
  with latest_swipe as (
    select distinct on (action.location_id)
      action.location_id,
      action.undone_at
    from public.discovery_actions action
    where action.profile_id=auth.uid()
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
    where state.profile_id=auth.uid()
      and state.location_id is not null
      and state.state in ('saved','interested','visited')
  )
  select location.id,
    location.duplicate_group_key,
    location.catalogue_group_key,
    location.name,
    location.latitude,
    location.longitude
  from public.locations location
  join seen_ids seen on seen.location_id=location.id
  where auth.uid() is not null
    and location.status='published';
$$;

revoke all on function public.discovery_seen_locations_v1() from public,anon;
grant execute on function public.discovery_seen_locations_v1() to authenticated;
