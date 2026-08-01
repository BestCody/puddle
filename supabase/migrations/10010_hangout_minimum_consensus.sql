create or replace function public.record_date_match_swipe_v1(
  target_deck uuid,
  target_location uuid,
  swipe_choice text,
  swipe_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  target_mode text;
  match_strength integer;
  own_progress integer;
  item_count integer;
  member_count integer;
  completed_members integer;
  positive_count integer;
  perfect_count integer;
  pass_count integer;
  positive_threshold integer;
  enough_members boolean := false;
  did_match boolean := false;
  was_match boolean := false;
  created_match boolean := false;
begin
  if actor is null then raise exception 'Authentication required.'; end if;
  if swipe_choice not in ('pass','save','perfect') then raise exception 'Swipe choice is invalid.'; end if;
  if not public.is_date_match_member(target_deck) then raise exception 'Shared deck membership required.'; end if;
  if not exists (select 1 from public.date_match_items where deck_id = target_deck and location_id = target_location) then raise exception 'Location is not in this deck.'; end if;

  insert into public.date_match_swipes(deck_id, profile_id, location_id, choice, note, updated_at)
  values (target_deck, actor, target_location, swipe_choice, nullif(left(trim(coalesce(swipe_note, '')), 280), ''), now())
  on conflict (deck_id, profile_id, location_id) do update set choice = excluded.choice, note = excluded.note, updated_at = now();

  select mode into target_mode from public.date_match_decks where id = target_deck;
  select count(*) into member_count from public.date_match_members where deck_id = target_deck;
  select
    count(*) filter (where choice in ('save','perfect')),
    count(*) filter (where choice = 'perfect'),
    count(*) filter (where choice = 'pass')
  into positive_count, perfect_count, pass_count
  from public.date_match_swipes where deck_id = target_deck and location_id = target_location;

  enough_members := (target_mode='date' and member_count>=2) or (target_mode='hangout' and member_count>=3);
  positive_threshold := case when target_mode = 'date' then 2 else greatest(2, ceil(member_count * 0.6)::integer) end;
  select exists (select 1 from public.date_match_matches where deck_id = target_deck and location_id = target_location) into was_match;
  did_match := enough_members and pass_count = 0 and positive_count >= positive_threshold;
  match_strength := least(4, 2 + perfect_count);

  if did_match then
    insert into public.date_match_matches(deck_id, location_id, strength, matched_at, updated_at)
    values (target_deck, target_location, match_strength, now(), now())
    on conflict (deck_id, location_id) do update set strength = excluded.strength, updated_at = now();
    created_match := not was_match;
  else
    delete from public.date_match_matches where deck_id = target_deck and location_id = target_location and status = 'matched';
  end if;

  if created_match then
    insert into public.app_notifications(profile_id, kind, title, body, href, metadata)
    select m.profile_id, 'match_found',
      case when target_mode = 'hangout' then 'Your group found a location' else 'It is a DateMatch' end,
      l.name || case when target_mode = 'hangout' then ' is a strong group match.' else ' was saved by both of you.' end,
      '/dashboard', jsonb_build_object('deckId', target_deck, 'locationId', target_location, 'mode', target_mode)
    from public.date_match_members m cross join public.locations l
    where m.deck_id = target_deck and l.id = target_location;
    perform public.record_recommendation_context_v1(target_location, 'matched', target_mode, null, jsonb_build_object('memberCount', member_count), target_deck);
  end if;

  select count(*) into own_progress from public.date_match_swipes where deck_id = target_deck and profile_id = actor;
  select count(*) into item_count from public.date_match_items where deck_id = target_deck;
  update public.date_match_members set completed_at = case when own_progress >= item_count then coalesce(completed_at, now()) else null end
  where deck_id = target_deck and profile_id = actor;
  select count(*) into completed_members from public.date_match_members where deck_id = target_deck and completed_at is not null;
  if enough_members and completed_members = member_count then
    update public.date_match_decks set status = case when status = 'planned' then status else 'completed' end, updated_at = now() where id = target_deck;
  end if;

  perform public.record_recommendation_context_v1(target_location, swipe_choice, target_mode, null, jsonb_build_object('shared', true), target_deck);

  return jsonb_build_object(
    'matched', did_match, 'newMatch', created_match, 'strength', match_strength,
    'progress', own_progress, 'itemCount', item_count, 'memberCount', member_count,
    'completedMembers', completed_members, 'positiveCount', positive_count,
    'perfectCount', perfect_count, 'passCount', pass_count, 'mode', target_mode,
    'enoughMembers', enough_members
  );
end;
$$;
