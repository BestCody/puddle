-- Correct the global moderation boundary introduced in 10045.
-- Moderation must deny an explicitly suspended/banned account; it must not
-- classify a temporarily missing profile row as a moderated account. The latter
-- broke profile recovery and legitimate authenticated write chains.

create or replace function public.is_moderated_profile_v1()
returns boolean
language sql
stable
security definer
set search_path=public
set row_security=off
as $$
  select exists(
    select 1
    from public.profiles profile
    where profile.id=auth.uid()
      and (profile.suspended_at is not null or profile.banned_at is not null)
  )
$$;
revoke all on function public.is_moderated_profile_v1() from public,anon;
grant execute on function public.is_moderated_profile_v1() to authenticated,service_role;

-- Keep the stronger predicate for RPCs that require a fully established
-- account, but make its profile lookup independent of caller RLS evaluation.
create or replace function public.is_active_profile_v1()
returns boolean
language sql
stable
security definer
set search_path=public
set row_security=off
as $$
  select auth.uid() is not null and exists(
    select 1
    from public.profiles profile
    where profile.id=auth.uid()
      and profile.suspended_at is null
      and profile.banned_at is null
  )
$$;
revoke all on function public.is_active_profile_v1() from public,anon;
grant execute on function public.is_active_profile_v1() to authenticated,service_role;

create or replace function public.assert_active_profile_v1()
returns boolean
language plpgsql
stable
security definer
set search_path=public
set row_security=off
as $$
declare
  actor uuid:=auth.uid();
  suspended timestamptz;
  banned timestamptz;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  select profile.suspended_at,profile.banned_at
  into suspended,banned
  from public.profiles profile
  where profile.id=actor;
  if not found then raise exception 'profile required' using errcode='42501'; end if;
  if banned is not null then raise exception 'account banned' using errcode='42501'; end if;
  if suspended is not null then raise exception 'account suspended' using errcode='42501'; end if;
  return true;
end;
$$;
revoke all on function public.assert_active_profile_v1() from public,anon;
grant execute on function public.assert_active_profile_v1() to authenticated,service_role;

-- Every trigger installed by 10045 already references this function by OID.
-- Replacing its body makes the global write boundary deny explicit moderation
-- state only. Missing profiles can complete the existing self-bootstrap path.
create or replace function public.reject_inactive_authenticated_write_v1()
returns trigger
language plpgsql
security definer
set search_path=public
set row_security=off
as $$
begin
  if coalesce(auth.role()::text,'')='authenticated'
    and public.is_moderated_profile_v1()
  then
    raise exception 'account unavailable' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.reject_inactive_authenticated_write_v1() from public,anon,authenticated;
grant execute on function public.reject_inactive_authenticated_write_v1() to service_role;

-- Replace the overly strict global RLS predicates. Existing permissive policies
-- continue to decide what a user may read/write. This restrictive policy adds
-- exactly one condition: the caller must not have an explicit moderation state.
do $$
declare
  target record;
begin
  for target in
    select distinct namespace.nspname as schema_name,relation.relname as table_name
    from pg_class relation
    join pg_namespace namespace on namespace.oid=relation.relnamespace
    join information_schema.role_table_grants grant_row
      on grant_row.table_schema=namespace.nspname
     and grant_row.table_name=relation.relname
     and grant_row.grantee='authenticated'
    where namespace.nspname='public'
      and relation.relkind in ('r','p')
      and relation.relrowsecurity
      and relation.relname not ilike '%appeal%'
  loop
    execute format('drop policy if exists %I on %I.%I','active profile gate',target.schema_name,target.table_name);
    execute format('drop policy if exists %I on %I.%I','active profile select gate',target.schema_name,target.table_name);
    execute format('drop policy if exists %I on %I.%I','active profile insert gate',target.schema_name,target.table_name);
    execute format('drop policy if exists %I on %I.%I','active profile update gate',target.schema_name,target.table_name);
    execute format('drop policy if exists %I on %I.%I','active profile delete gate',target.schema_name,target.table_name);
    execute format('drop policy if exists %I on %I.%I','moderation profile gate',target.schema_name,target.table_name);
    execute format(
      'create policy %I on %I.%I as restrictive for all to authenticated using (not public.is_moderated_profile_v1()) with check (not public.is_moderated_profile_v1())',
      'moderation profile gate',target.schema_name,target.table_name
    );
  end loop;
end
$$;
