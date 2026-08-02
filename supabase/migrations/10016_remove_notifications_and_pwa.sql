-- Puddle now surfaces matches and plans in their own pages. Remove the
-- install/push notification data path while preserving shared-deck behavior.

drop function if exists public.enqueue_location_plan_notifications_v1();

create or replace function public.join_date_match_v1(invite_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  actor uuid := auth.uid();
  target public.date_match_decks%rowtype;
  member_count integer;
  member_role text;
begin
  if actor is null then raise exception 'Authentication required.'; end if;
  if invite_token is null or char_length(trim(invite_token)) < 32 then
    raise exception 'Shared deck link is invalid.';
  end if;

  select * into target
  from public.date_match_decks
  where invite_token_hash = encode(digest(trim(invite_token), 'sha256'), 'hex')
    and expires_at > now()
    and status <> 'archived'
  for update;

  if target.id is null then
    raise exception 'Shared deck link is invalid or expired.';
  end if;

  select role into member_role
  from public.date_match_members
  where deck_id = target.id and profile_id = actor;

  if member_role is null then
    if target.mode = 'hangout' and (
      target.status = 'planned'
      or exists (
        select 1 from public.date_match_matches
        where deck_id = target.id and status in ('planned','happened')
      )
    ) then
      raise exception 'This Hangout Match already has a confirmed plan.';
    end if;

    select count(*) into member_count
    from public.date_match_members
    where deck_id = target.id;

    if member_count >= target.max_members then
      raise exception 'This shared deck is already full.';
    end if;

    insert into public.date_match_members(deck_id, profile_id, role)
    values (target.id, actor, 'partner');
    member_role := 'partner';

    if target.mode = 'hangout' then
      delete from public.date_match_matches
      where deck_id = target.id and status = 'matched';

      update public.date_match_decks
      set status = 'open', updated_at = now()
      where id = target.id and status = 'completed';
    end if;
  end if;

  select count(*) into member_count
  from public.date_match_members
  where deck_id = target.id;

  return jsonb_build_object(
    'deckId', target.id,
    'role', member_role,
    'mode', target.mode,
    'maxMembers', target.max_members,
    'memberCount', member_count
  );
end;
$$;

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
  partner_note text;
  match_strength integer;
  own_progress integer;
  item_count integer;
  member_count integer;
  completed_members integer;
  vote_count integer;
  positive_count integer;
  perfect_count integer;
  pass_count integer;
  positive_threshold integer;
  enough_members boolean := false;
  all_members_voted boolean := false;
  did_match boolean := false;
  was_match boolean := false;
  created_match boolean := false;
begin
  if actor is null then raise exception 'Authentication required.'; end if;
  if swipe_choice not in ('pass','save','perfect') then raise exception 'Swipe choice is invalid.'; end if;
  if not public.is_date_match_member(target_deck) then raise exception 'Shared deck membership required.'; end if;
  if not exists (
    select 1 from public.date_match_items
    where deck_id = target_deck and location_id = target_location
  ) then raise exception 'Location is not in this deck.'; end if;

  insert into public.date_match_swipes(deck_id, profile_id, location_id, choice, note, updated_at)
  values (
    target_deck,
    actor,
    target_location,
    swipe_choice,
    nullif(left(trim(coalesce(swipe_note, '')), 280), ''),
    now()
  )
  on conflict (deck_id, profile_id, location_id) do update
    set choice = excluded.choice,
        note = excluded.note,
        updated_at = now();

  select mode into target_mode
  from public.date_match_decks
  where id = target_deck;

  select count(*) into member_count
  from public.date_match_members
  where deck_id = target_deck;

  select
    count(*),
    count(*) filter (where choice in ('save','perfect')),
    count(*) filter (where choice = 'perfect'),
    count(*) filter (where choice = 'pass')
  into vote_count, positive_count, perfect_count, pass_count
  from public.date_match_swipes
  where deck_id = target_deck and location_id = target_location;

  enough_members :=
    (target_mode = 'date' and member_count >= 2)
    or (target_mode = 'hangout' and member_count >= 3);
  all_members_voted := vote_count = member_count;
  positive_threshold := case
    when target_mode = 'date' then 2
    else greatest(2, ceil(member_count * 0.6)::integer)
  end;

  select exists (
    select 1 from public.date_match_matches
    where deck_id = target_deck and location_id = target_location
  ) into was_match;

  did_match := enough_members
    and all_members_voted
    and pass_count = 0
    and positive_count >= positive_threshold;
  match_strength := least(4, 2 + perfect_count);

  if did_match then
    insert into public.date_match_matches(deck_id, location_id, strength, matched_at, updated_at)
    values (target_deck, target_location, match_strength, now(), now())
    on conflict (deck_id, location_id) do update
      set strength = excluded.strength,
          updated_at = now();
    created_match := not was_match;
  else
    delete from public.date_match_matches
    where deck_id = target_deck
      and location_id = target_location
      and status = 'matched';
  end if;

  if did_match and target_mode = 'date' then
    select s.note into partner_note
    from public.date_match_swipes s
    where s.deck_id = target_deck
      and s.location_id = target_location
      and s.profile_id <> actor
      and s.choice in ('save','perfect')
    limit 1;
  end if;

  if created_match then
    perform public.record_recommendation_context_v1(
      target_location,
      'matched',
      target_mode,
      null,
      jsonb_build_object('memberCount', member_count),
      target_deck
    );
  end if;

  select count(*) into own_progress
  from public.date_match_swipes
  where deck_id = target_deck and profile_id = actor;

  select count(*) into item_count
  from public.date_match_items
  where deck_id = target_deck;

  update public.date_match_members
  set completed_at = case
    when own_progress >= item_count then coalesce(completed_at, now())
    else null
  end
  where deck_id = target_deck and profile_id = actor;

  select count(*) into completed_members
  from public.date_match_members
  where deck_id = target_deck and completed_at is not null;

  if enough_members and completed_members = member_count then
    update public.date_match_decks
    set status = case when status = 'planned' then status else 'completed' end,
        updated_at = now()
    where id = target_deck;
  end if;

  perform public.record_recommendation_context_v1(
    target_location,
    swipe_choice,
    target_mode,
    null,
    jsonb_build_object('shared', true),
    target_deck
  );

  return jsonb_build_object(
    'matched', did_match,
    'newMatch', created_match,
    'strength', match_strength,
    'partnerNote', case when did_match and target_mode = 'date' then partner_note else null end,
    'progress', own_progress,
    'itemCount', item_count,
    'memberCount', member_count,
    'completedMembers', completed_members,
    'voteCount', vote_count,
    'positiveCount', positive_count,
    'perfectCount', perfect_count,
    'passCount', pass_count,
    'mode', target_mode,
    'enoughMembers', enough_members,
    'allMembersVoted', all_members_voted
  );
end;
$$;

create or replace function public.schedule_date_match_v1(target_deck uuid, target_location uuid, planned_time timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare target_mode text;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not public.is_date_match_member(target_deck) then raise exception 'Shared deck membership required.'; end if;
  if planned_time is null or planned_time <= now() then raise exception 'Choose a future date and time.'; end if;
  update public.date_match_matches set planned_for = planned_time, status = 'planned', updated_at = now()
  where deck_id = target_deck and location_id = target_location;
  if not found then raise exception 'Choose a shared match before planning it.'; end if;
  update public.date_match_decks set status = 'planned', updated_at = now() where id = target_deck returning mode into target_mode;
  perform public.record_recommendation_context_v1(target_location, 'planned', coalesce(target_mode, 'date'), null, jsonb_build_object('shared', true), target_deck);
  return jsonb_build_object('plannedFor', planned_time);
end;
$$;

grant execute on function public.join_date_match_v1(text) to authenticated;
grant execute on function public.record_date_match_swipe_v1(uuid, uuid, text, text) to authenticated;
grant execute on function public.schedule_date_match_v1(uuid, uuid, timestamptz) to authenticated;

drop table if exists public.push_delivery_attempts cascade;
drop table if exists public.push_delivery_outbox cascade;
drop table if exists public.notification_delivery_attempts cascade;
drop table if exists public.push_subscriptions cascade;
drop table if exists public.app_notifications cascade;
drop table if exists public.notification_outbox cascade;
