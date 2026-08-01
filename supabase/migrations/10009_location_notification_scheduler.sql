alter table public.app_notifications add column if not exists dedupe_key text;
create unique index if not exists app_notifications_profile_dedupe_idx
  on public.app_notifications(profile_id, dedupe_key)
  where dedupe_key is not null;

create or replace function public.enqueue_location_plan_notifications_v1()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer := 0;
  step_count integer := 0;
begin
  insert into public.app_notifications(profile_id, kind, title, body, href, metadata, dedupe_key)
  select m.profile_id, 'plan_reminder',
    case when d.mode='hangout' then 'Your hangout is tomorrow' else 'Your date plan is tomorrow' end,
    l.name || ' is planned for ' || to_char(dm.planned_for at time zone 'UTC', 'Mon DD at HH12:MI AM') || '.',
    '/plans?tab=planned',
    jsonb_build_object('deckId',dm.deck_id,'locationId',dm.location_id,'plannedFor',dm.planned_for,'mode',d.mode),
    'shared-reminder:'||dm.deck_id||':'||dm.location_id||':'||to_char(dm.planned_for,'YYYYMMDDHH24MI')
  from public.date_match_matches dm
  join public.date_match_decks d on d.id=dm.deck_id
  join public.date_match_members m on m.deck_id=dm.deck_id
  join public.locations l on l.id=dm.location_id
  where dm.status='planned' and dm.planned_for between now()+interval '23 hours' and now()+interval '25 hours'
  on conflict(profile_id,dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics step_count=row_count; changed:=changed+step_count;

  insert into public.app_notifications(profile_id, kind, title, body, href, metadata, dedupe_key)
  select v.profile_id, 'plan_reminder', 'Your location plan is tomorrow',
    l.name || ' is planned for ' || to_char(v.planned_for at time zone 'UTC', 'Mon DD at HH12:MI AM') || '.',
    '/plans?tab=planned', jsonb_build_object('locationId',v.location_id,'plannedFor',v.planned_for,'mode','solo'),
    'personal-reminder:'||v.profile_id||':'||v.location_id||':'||to_char(v.planned_for,'YYYYMMDDHH24MI')
  from public.location_visits v join public.locations l on l.id=v.location_id
  where v.status='planned' and v.planned_for between now()+interval '23 hours' and now()+interval '25 hours'
  on conflict(profile_id,dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics step_count=row_count; changed:=changed+step_count;

  insert into public.app_notifications(profile_id, kind, title, body, href, metadata, dedupe_key)
  select m.profile_id, 'feedback_ready', 'How did the location work?',
    'Tell Puddle how '||l.name||' worked so future recommendations get smarter.',
    '/plans?tab=past',
    jsonb_build_object('deckId',dm.deck_id,'locationId',dm.location_id,'mode',d.mode),
    'shared-feedback:'||dm.deck_id||':'||dm.location_id
  from public.date_match_matches dm
  join public.date_match_decks d on d.id=dm.deck_id
  join public.date_match_members m on m.deck_id=dm.deck_id
  join public.locations l on l.id=dm.location_id
  where dm.status='planned' and dm.planned_for between now()-interval '3 days' and now()-interval '1 day'
    and not exists(select 1 from public.date_match_feedback f where f.deck_id=dm.deck_id and f.location_id=dm.location_id and f.profile_id=m.profile_id)
  on conflict(profile_id,dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics step_count=row_count; changed:=changed+step_count;

  return changed;
end;
$$;

revoke all on function public.enqueue_location_plan_notifications_v1() from public;
grant execute on function public.enqueue_location_plan_notifications_v1() to service_role;
