-- Stage 1 authorization contract checks. Run after all migrations in a disposable database.
begin;

do $$
declare
  table_name text;
  required_tables text[] := array['host_profiles','host_members','locations','event_permissions','user_content_states'];
begin
  foreach table_name in array required_tables loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=table_name and c.relrowsecurity
    ) then
      raise exception 'RLS is not enabled on public.%', table_name;
    end if;
  end loop;
end $$;

do $$
declare
  required_policy text;
  policies text[] := array[
    'host profiles visible',
    'users create host profiles',
    'host owners update profiles',
    'host members visible to members',
    'published locations public read',
    'users create locations',
    'location creators manage',
    'event permissions visible',
    'event owners manage permissions',
    'own unified content states',
    'unified event creators manage'
  ];
begin
  foreach required_policy in array policies loop
    if not exists (select 1 from pg_policies where schemaname='public' and policyname=required_policy) then
      raise exception 'Missing Stage 1 policy: %', required_policy;
    end if;
  end loop;
end $$;

do $$
begin
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='is_host_member' and prosecdef) then
    raise exception 'is_host_member must exist as SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='has_host_role' and prosecdef) then
    raise exception 'has_host_role must exist as SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='can_manage_event' and prosecdef) then
    raise exception 'can_manage_event must exist as SECURITY DEFINER';
  end if;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name in ('dating_enabled','social_matching_enabled')) then
    raise exception 'Dating or profile-matching fields remain on profiles';
  end if;
  if to_regclass('public.profile_swipes') is not null or to_regclass('public.matches') is not null then
    raise exception 'Legacy person-matching tables remain';
  end if;
  if not exists (select 1 from pg_constraint where conname='one_content_target') then
    raise exception 'Unified content state target constraint is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname='events_unified_creator_required') then
    raise exception 'Unified event creator constraint is missing';
  end if;
end $$;

rollback;
