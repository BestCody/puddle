-- Assertions for Stage 4 plans, attendance, waitlists, and collaboration.
do $$
declare missing text;
begin
  select string_agg(name, ', ') into missing
  from (values
    ('event_checkins'),('location_visits'),('plans'),('plan_members'),('plan_availability'),
    ('plan_stops'),('plan_polls'),('plan_poll_options'),('plan_votes'),('plan_messages')
  ) expected(name)
  where not exists(select 1 from information_schema.tables where table_schema='public' and table_name=expected.name);
  if missing is not null then raise exception 'Missing Stage 4 tables: %',missing; end if;

  select string_agg(name, ', ') into missing
  from (values
    ('request_event_attendance_v1'),('cancel_event_attendance_v1'),('approve_event_attendance_v1'),
    ('check_in_attendee_v1'),('promote_event_waitlist_v1'),('promote_event_waitlist_as_manager_v1'),('add_plan_stop_v1'),('can_checkin_event'),
    ('is_plan_member'),('can_edit_plan'),('respond_plan_invitation_v1'),('protect_plan_member_identity')
  ) expected(name)
  where not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=expected.name);
  if missing is not null then raise exception 'Missing Stage 4 functions: %',missing; end if;

  select string_agg(name, ', ') into missing
  from (values
    ('event_checkins'),('location_visits'),('plans'),('plan_members'),('plan_availability'),
    ('plan_stops'),('plan_polls'),('plan_poll_options'),('plan_votes'),('plan_messages')
  ) expected(name)
  where not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=expected.name and c.relrowsecurity);
  if missing is not null then raise exception 'RLS is not enabled for Stage 4 tables: %',missing; end if;

  if not exists(select 1 from pg_constraint where conname='event_rsvps_status_check') then raise exception 'Expanded RSVP status constraint is missing'; end if;
  if not exists(select 1 from pg_constraint where conname='plan_stop_one_target') then raise exception 'Plan stop target constraint is missing'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='event_waitlist_position_unique') then raise exception 'Waitlist position uniqueness is missing'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='event_rsvps' and policyname='event managers read attendee records') then raise exception 'Creator attendee access policy is missing'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='plan_messages' and policyname='plan members send messages') then raise exception 'Plan chat authorization policy is missing'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='event_rsvps' and policyname='own rsvps') then raise exception 'Direct RSVP writes still bypass transactional capacity controls'; end if;
  if not exists(select 1 from pg_trigger where tgname='plan_members_protect_identity' and not tgisinternal) then raise exception 'Plan membership role protection trigger is missing'; end if;
end $$;
