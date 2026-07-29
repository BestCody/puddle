-- Assertions for Stage 3 secure media and discovery.
do $$
declare missing text;
begin
  select string_agg(name, ', ') into missing
  from (values
    ('media_assets'),('event_media'),('location_media'),('message_media'),('verification_documents'),
    ('discovery_impressions'),('discovery_actions')
  ) expected(name)
  where not exists(select 1 from information_schema.tables where table_schema='public' and table_name=expected.name);
  if missing is not null then raise exception 'Missing Stage 3 tables: %',missing; end if;

  select string_agg(name, ', ') into missing
  from (values ('discover_candidates_v1'),('content_in_view_v1'),('record_discovery_action_v1'),('can_view_media_asset'),('assert_media_pointer')) expected(name)
  where not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=expected.name);
  if missing is not null then raise exception 'Missing Stage 3 functions: %',missing; end if;

  select string_agg(name, ', ') into missing
  from (values
    ('media_assets'),('event_media'),('location_media'),('message_media'),('verification_documents'),
    ('discovery_impressions'),('discovery_actions')
  ) expected(name)
  where not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=expected.name and c.relrowsecurity);
  if missing is not null then raise exception 'RLS is not enabled for Stage 3 tables: %',missing; end if;

  if not exists(select 1 from storage.buckets where id='puddle-public-media' and public=true) then raise exception 'Public media bucket is missing'; end if;
  if not exists(select 1 from storage.buckets where id='puddle-private-media' and public=false) then raise exception 'Private media bucket is missing'; end if;
  if not exists(select 1 from storage.buckets where id='puddle-quarantine' and public=false) then raise exception 'Quarantine bucket is missing'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='locations_discovery_gix') then raise exception 'PostGIS discovery index is missing'; end if;
  if exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and cmd in ('INSERT','UPDATE','DELETE') and roles::text like '%authenticated%' and policyname like '%upload%') then raise exception 'Authenticated clients can bypass the server media pipeline'; end if;
  if not exists(select 1 from pg_trigger where tgname='events_validate_cover' and not tgisinternal) then raise exception 'Event cover integrity trigger is missing'; end if;
  if not exists(select 1 from pg_trigger where tgname='profiles_validate_avatar' and not tgisinternal) then raise exception 'Profile avatar integrity trigger is missing'; end if;
  if not exists(select 1 from pg_constraint where conname='approved_media_is_clean') then raise exception 'Approved media cleanliness constraint is missing'; end if;
end $$;
