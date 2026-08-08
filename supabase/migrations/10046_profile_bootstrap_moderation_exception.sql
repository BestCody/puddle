-- Keep missing-profile recovery compatible with the global moderation gate.
-- A signed-in user may bootstrap only their own absent profile. Existing
-- suspended/banned profiles remain blocked from reads and writes.

create or replace function public.can_bootstrap_own_profile_v1(candidate_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select auth.uid() is not null
    and candidate_id=auth.uid()
    and not exists(
      select 1
      from public.profiles profile
      where profile.id=auth.uid()
    )
$$;
revoke all on function public.can_bootstrap_own_profile_v1(uuid) from public,anon;
grant execute on function public.can_bootstrap_own_profile_v1(uuid) to authenticated,service_role;

-- The generic restrictive ALL policy from 10045 correctly blocks inactive
-- profiles, but it also makes a genuinely missing profile impossible to
-- recreate. Split the profiles policy by command so only INSERT can use the
-- narrow self-bootstrap exception.
drop policy if exists "active profile gate" on public.profiles;
drop policy if exists "active profile select gate" on public.profiles;
drop policy if exists "active profile insert gate" on public.profiles;
drop policy if exists "active profile update gate" on public.profiles;
drop policy if exists "active profile delete gate" on public.profiles;

create policy "active profile select gate"
on public.profiles
as restrictive
for select
to authenticated
using (public.is_active_profile_v1());

create policy "active profile insert gate"
on public.profiles
as restrictive
for insert
to authenticated
with check (
  public.is_active_profile_v1()
  or public.can_bootstrap_own_profile_v1(id)
);

create policy "active profile update gate"
on public.profiles
as restrictive
for update
to authenticated
using (public.is_active_profile_v1())
with check (public.is_active_profile_v1());

create policy "active profile delete gate"
on public.profiles
as restrictive
for delete
to authenticated
using (public.is_active_profile_v1());

-- All runtime write triggers point at this function, so replacing it keeps the
-- global gate while allowing only the before-insert case needed to recreate an
-- absent self profile. An existing inactive profile cannot reach the exception.
create or replace function public.reject_inactive_authenticated_write_v1()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if coalesce(auth.role()::text,'')='authenticated' then
    if tg_table_schema='public'
      and tg_table_name='profiles'
      and tg_op='INSERT'
      and public.can_bootstrap_own_profile_v1(new.id)
    then
      return new;
    end if;

    if not public.is_active_profile_v1() then
      raise exception 'account unavailable' using errcode='42501';
    end if;
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.reject_inactive_authenticated_write_v1() from public,anon,authenticated;
grant execute on function public.reject_inactive_authenticated_write_v1() to service_role;
