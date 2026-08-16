-- Targeted latency optimizations for authenticated dashboard hot paths.
-- Keep authorization semantics unchanged while avoiding repeated auth.uid()
-- evaluation and collapsing shell bootstrap data into one round trip.

create or replace function public.dashboard_bootstrap_v1(known_privileged boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_access jsonb := jsonb_build_object('allowed', false);
  v_unread bigint := 0;
  v_pass boolean := false;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if known_privileged then
    v_access := jsonb_build_object('allowed', true);
  else
    v_access := public.privileged_access_v1(array[]::text[]);
  end if;

  select count(*)
    into v_unread
  from public.notifications
  where profile_id = v_uid
    and read_at is null;

  v_pass := coalesce(public.puddle_tinder_active_v1(), false);

  return jsonb_build_object(
    'show_admin', coalesce((v_access ->> 'allowed')::boolean, false),
    'unread_notifications', v_unread,
    'pass_active', v_pass
  );
end;
$$;

revoke all on function public.dashboard_bootstrap_v1(boolean) from public;
revoke all on function public.dashboard_bootstrap_v1(boolean) from anon;
grant execute on function public.dashboard_bootstrap_v1(boolean) to authenticated;

-- Hot relationship lookups are symmetric, so cover both sides explicitly.
create index if not exists friendships_requester_idx
  on public.friendships (requester_id);
create index if not exists friendships_addressee_idx
  on public.friendships (addressee_id);

-- Evaluate authenticated user identity once per statement rather than once per row.
alter policy "profiles self read" on public.profiles
  using (id = (select auth.uid()));

alter policy "profiles self update" on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

alter policy "users read own notifications" on public.notifications
  using (profile_id = (select auth.uid()));

alter policy "users update own notifications" on public.notifications
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

alter policy "users read own discovery actions" on public.discovery_actions
  using (profile_id = (select auth.uid()));

alter policy "users read own impressions" on public.discovery_impressions
  using (profile_id = (select auth.uid()));

alter policy "users log own impressions" on public.discovery_impressions
  with check (profile_id = (select auth.uid()));

alter policy "members read own membership" on public.puddle_memberships
  using (profile_id = (select auth.uid()));

alter policy "friendship participants read" on public.friendships
  using (((select auth.uid()) = requester_id) or ((select auth.uid()) = addressee_id));
