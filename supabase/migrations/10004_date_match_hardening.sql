create or replace function public.schedule_date_match_v1(
  target_deck uuid,
  target_location uuid,
  planned_time timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not public.is_date_match_member(target_deck) then raise exception 'DateMatch membership required.'; end if;
  if planned_time is null or planned_time <= now() then raise exception 'Choose a future date and time.'; end if;

  update public.date_match_matches
  set planned_for = planned_time, status = 'planned', updated_at = now()
  where deck_id = target_deck and location_id = target_location;
  if not found then raise exception 'Choose a mutual match before planning it.'; end if;

  update public.date_match_decks set status = 'planned', updated_at = now() where id = target_deck;
  return jsonb_build_object('plannedFor', planned_time);
end;
$$;

create or replace function public.record_date_match_feedback_v1(
  target_deck uuid,
  target_location uuid,
  did_happen boolean,
  date_rating text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Authentication required.'; end if;
  if not public.is_date_match_member(target_deck) then raise exception 'DateMatch membership required.'; end if;
  if did_happen and coalesce(date_rating, '') not in ('great','okay','not_for_us') then raise exception 'Choose how the date location worked.'; end if;

  insert into public.date_match_feedback(deck_id, location_id, profile_id, happened, rating, updated_at)
  values (target_deck, target_location, actor, did_happen, case when did_happen then date_rating else null end, now())
  on conflict (deck_id, location_id, profile_id) do update
    set happened = excluded.happened, rating = excluded.rating, updated_at = now();

  if did_happen then
    update public.date_match_matches set status = 'happened', updated_at = now()
    where deck_id = target_deck and location_id = target_location;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.create_date_match_v1(uuid[], double precision, double precision) from public;
revoke all on function public.join_date_match_v1(text) from public;
revoke all on function public.record_date_match_swipe_v1(uuid, uuid, text, text) from public;
revoke all on function public.schedule_date_match_v1(uuid, uuid, timestamptz) from public;
revoke all on function public.record_date_match_feedback_v1(uuid, uuid, boolean, text) from public;
revoke all on function public.date_match_reveals_v1(uuid) from public;

grant execute on function public.create_date_match_v1(uuid[], double precision, double precision) to authenticated;
grant execute on function public.join_date_match_v1(text) to authenticated;
grant execute on function public.record_date_match_swipe_v1(uuid, uuid, text, text) to authenticated;
grant execute on function public.schedule_date_match_v1(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.record_date_match_feedback_v1(uuid, uuid, boolean, text) to authenticated;
grant execute on function public.date_match_reveals_v1(uuid) to authenticated;
