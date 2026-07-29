-- Stage 2 schema and authorization assertions. Run after applying migrations through 0007.
do $$
declare missing text;
begin
  select string_agg(name, ', ') into missing
  from (values ('event_occurrences'),('event_revisions'),('location_revisions'),('location_claims'),('event_private_details'),('location_private_details')) expected(name)
  where not exists (select 1 from information_schema.tables where table_schema='public' and table_name=expected.name);
  if missing is not null then raise exception 'Missing Stage 2 tables: %', missing; end if;

  select string_agg(name, ', ') into missing
  from (values
    ('events.event_format'),('events.visibility'),('events.recurrence_rule'),('events.publish_at'),('events.attendee_questions'),('events.accessibility'),('events.contact_links'),('events.has_private_address'),
    ('locations.has_private_address'),('locations.visibility'),('locations.tags'),('locations.contact_links'),('locations.claimed_by_host_id'),('host_profiles.contact_links')
  ) expected(name)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema='public'
      and c.table_name=split_part(expected.name,'.',1)
      and c.column_name=split_part(expected.name,'.',2)
  );
  if missing is not null then raise exception 'Missing Stage 2 columns: %', missing; end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name in ('events','locations') and column_name='private_address') then
    raise exception 'Private addresses remain exposed on public listing tables';
  end if;

  select string_agg(name, ', ') into missing
  from (values ('event_occurrences'),('event_revisions'),('location_revisions'),('location_claims'),('event_private_details'),('location_private_details')) expected(name)
  where not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=expected.name and c.relrowsecurity);
  if missing is not null then raise exception 'RLS is not enabled on: %', missing; end if;

  select string_agg(name, ', ') into missing
  from (values ('request_event_publication'),('transition_event_status'),('request_location_publication'),('transition_location_status'),('publish_due_events'),('can_manage_location')) expected(name)
  where not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=expected.name and p.prosecdef);
  if missing is not null then raise exception 'Missing SECURITY DEFINER functions: %', missing; end if;

  if not exists (select 1 from pg_trigger where tgname='events_guard_publication_fields' and not tgisinternal) then raise exception 'Controlled event status trigger is missing'; end if;
  if not exists (select 1 from pg_trigger where tgname='locations_guard_publication_fields' and not tgisinternal) then raise exception 'Controlled location status trigger is missing'; end if;
  if not exists (select 1 from pg_trigger where tgname='events_capture_revision' and not tgisinternal) then raise exception 'Event revision trigger is missing'; end if;
  if not exists (select 1 from pg_trigger where tgname='locations_capture_revision' and not tgisinternal) then raise exception 'Location revision trigger is missing'; end if;
  if not exists (select 1 from pg_trigger where tgname='events_sync_occurrences' and not tgisinternal) then raise exception 'Event recurrence trigger is missing'; end if;
  if not exists (select 1 from pg_trigger where tgname='event_private_details_sync_flag' and not tgisinternal) then raise exception 'Event private-address integrity trigger is missing'; end if;
  if not exists (select 1 from pg_trigger where tgname='location_private_details_sync_flag' and not tgisinternal) then raise exception 'Location private-address integrity trigger is missing'; end if;

  select string_agg(policyname, ', ') into missing
  from (values
    ('event managers manage private details'),('location managers manage private details'),('published event occurrences read'),('event managers manage occurrences'),('event managers read revisions'),('location managers read revisions'),
    ('claimants submit location claims'),('claim participants read claims'),('claimants withdraw claims'),('moderators manage location claims')
  ) expected(policyname)
  where not exists (select 1 from pg_policies p where p.schemaname='public' and p.policyname=expected.policyname);
  if missing is not null then raise exception 'Missing Stage 2 RLS policies: %', missing; end if;

  if not exists (select 1 from pg_constraint where conname='events_format_check') then raise exception 'Event format validation constraint is missing'; end if;
  if not exists (select 1 from pg_constraint where conname='events_visibility_check') then raise exception 'Event visibility validation constraint is missing'; end if;
  if not exists (select 1 from pg_constraint where conname='locations_visibility_check') then raise exception 'Location visibility validation constraint is missing'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='location_claims_open_unique') then raise exception 'Open claim uniqueness is missing'; end if;
end $$;
