create extension if not exists pgcrypto with schema extensions;

alter table public.date_match_decks
  add column if not exists mode text not null default 'date' check (mode in ('date','hangout')),
  add column if not exists max_members smallint not null default 2 check (max_members between 2 and 8),
  add column if not exists context jsonb not null default '{}'::jsonb;

alter table public.date_match_members
  add column if not exists completed_at timestamptz;

create table if not exists public.recommendation_context_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  deck_id uuid references public.date_match_decks(id) on delete set null,
  event_type text not null check (event_type in ('opened','pass','save','perfect','matched','planned','visited','great','okay','not_for_us')),
  mode text not null default 'solo' check (mode in ('solo','date','hangout')),
  category text,
  daypart text not null default 'any' check (daypart in ('morning','afternoon','evening','late','any')),
  weekend boolean not null default false,
  weight numeric(7,3) not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists recommendation_context_profile_idx on public.recommendation_context_events(profile_id, created_at desc);
create index if not exists recommendation_context_affinity_idx on public.recommendation_context_events(profile_id, mode, category, daypart, weekend);

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('group_joined','match_found','plan_scheduled','plan_reminder','feedback_ready','system')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 320),
  href text not null default '/dashboard' check (left(href, 1) = '/'),
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists app_notifications_profile_idx on public.app_notifications(profile_id, read_at, created_at desc);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 2000),
  p256dh text not null check (char_length(p256dh) between 20 and 500),
  auth text not null check (char_length(auth) between 8 and 500),
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_profile_idx on public.push_subscriptions(profile_id, updated_at desc);

alter table public.recommendation_context_events enable row level security;
alter table public.app_notifications enable row level security;
alter table public.push_subscriptions enable row level security;

create policy recommendation_context_read_own on public.recommendation_context_events
  for select to authenticated using (profile_id = auth.uid());
create policy app_notifications_read_own on public.app_notifications
  for select to authenticated using (profile_id = auth.uid());
create policy app_notifications_update_own on public.app_notifications
  for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy push_subscriptions_read_own on public.push_subscriptions
  for select to authenticated using (profile_id = auth.uid());
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated with check (profile_id = auth.uid());
create policy push_subscriptions_update_own on public.push_subscriptions
  for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated using (profile_id = auth.uid());

grant select on public.recommendation_context_events, public.app_notifications, public.push_subscriptions to authenticated;
grant update on public.app_notifications to authenticated;
grant insert, update, delete on public.push_subscriptions to authenticated;

create or replace function public.context_event_weight_v1(event_name text)
returns numeric
language sql
immutable
as $$
  select case event_name
    when 'opened' then 0.35
    when 'pass' then -2.0
    when 'save' then 2.5
    when 'perfect' then 4.5
    when 'matched' then 4.0
    when 'planned' then 5.5
    when 'visited' then 6.0
    when 'great' then 8.0
    when 'okay' then 2.0
    when 'not_for_us' then -5.0
    else 0
  end;
$$;

create or replace function public.record_recommendation_context_v1(
  target_location uuid,
  event_name text,
  context_mode text default 'solo',
  context_category text default null,
  context_payload jsonb default '{}'::jsonb,
  context_deck uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  resolved_category text;
  resolved_daypart text;
  event_weight numeric;
  local_hour integer;
begin
  if actor is null then raise exception 'Authentication required.'; end if;
  if event_name not in ('opened','pass','save','perfect','matched','planned','visited','great','okay','not_for_us') then raise exception 'Context event is invalid.'; end if;
  if context_mode not in ('solo','date','hangout') then context_mode := 'solo'; end if;
  if target_location is not null and not exists (select 1 from public.locations where id = target_location) then raise exception 'Location is invalid.'; end if;

  select coalesce(nullif(trim(context_category), ''), kind) into resolved_category
  from public.locations where id = target_location;
  resolved_category := coalesce(resolved_category, nullif(trim(context_category), ''), 'other');
  local_hour := extract(hour from now())::integer;
  resolved_daypart := coalesce(nullif(context_payload->>'daypart', ''), case
    when local_hour between 5 and 11 then 'morning'
    when local_hour between 12 and 16 then 'afternoon'
    when local_hour between 17 and 22 then 'evening'
    else 'late'
  end);
  if resolved_daypart not in ('morning','afternoon','evening','late','any') then resolved_daypart := 'any'; end if;
  event_weight := public.context_event_weight_v1(event_name);

  insert into public.recommendation_context_events(
    profile_id, location_id, deck_id, event_type, mode, category, daypart, weekend, weight, context
  ) values (
    actor, target_location, context_deck, event_name, context_mode, left(resolved_category, 80), resolved_daypart,
    extract(isodow from now()) in (6,7), event_weight, coalesce(context_payload, '{}'::jsonb)
  );

  return jsonb_build_object('ok', true, 'weight', event_weight, 'category', resolved_category, 'daypart', resolved_daypart);
end;
$$;

create or replace function public.recommendation_context_scores_v1(
  target_mode text default 'solo',
  target_daypart text default 'any',
  target_weekend boolean default false
)
returns table(category text, affinity numeric, evidence_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select e.category,
    round((sum(e.weight * case
      when e.mode = target_mode and e.daypart = target_daypart and e.weekend = target_weekend then 1.45
      when e.mode = target_mode then 1.2
      when e.mode = 'solo' then 1.0
      else 0.72
    end) / greatest(1, sqrt(count(*)::numeric)))::numeric, 3) as affinity,
    count(*) as evidence_count
  from public.recommendation_context_events e
  where e.profile_id = auth.uid()
    and e.created_at > now() - interval '180 days'
    and e.category is not null
  group by e.category
  order by affinity desc
  limit 100;
$$;

create or replace function public.create_shared_location_deck_v2(
  location_ids uuid[],
  center_lat double precision default null,
  center_lng double precision default null,
  deck_mode text default 'date',
  member_limit integer default 2,
  deck_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  actor uuid := auth.uid();
  target_deck uuid;
  raw_token text := encode(gen_random_bytes(32), 'hex');
  inserted_count integer := 0;
  safe_limit integer;
begin
  if actor is null then raise exception 'Authentication required.'; end if;
  if location_ids is null or cardinality(location_ids) < 2 then raise exception 'At least two locations are required.'; end if;
  if deck_mode not in ('date','hangout') then raise exception 'Shared deck mode is invalid.'; end if;
  safe_limit := case when deck_mode = 'date' then 2 else least(8, greatest(3, coalesce(member_limit, 4))) end;
  if center_lat is not null and (center_lat < -90 or center_lat > 90) then raise exception 'Latitude is invalid.'; end if;
  if center_lng is not null and (center_lng < -180 or center_lng > 180) then raise exception 'Longitude is invalid.'; end if;

  insert into public.date_match_decks(created_by, invite_token_hash, center_latitude, center_longitude, mode, max_members, context)
  values (actor, encode(digest(raw_token, 'sha256'), 'hex'), center_lat, center_lng, deck_mode, safe_limit, coalesce(deck_context, '{}'::jsonb))
  returning id into target_deck;

  insert into public.date_match_members(deck_id, profile_id, role)
  values (target_deck, actor, 'creator');

  with valid as (
    select l.id, min(input.ordinality) as first_position
    from unnest(location_ids) with ordinality as input(location_id, ordinality)
    join public.locations l on l.id = input.location_id
    where l.status = 'published' and l.visibility = 'public' and coalesce(l.has_private_address, false) = false
    group by l.id order by min(input.ordinality) limit 12
  ), ordered as (
    select id, row_number() over (order by first_position) - 1 as position from valid
  )
  insert into public.date_match_items(deck_id, location_id, sort_order, is_puddle_pick)
  select target_deck, id, position, position = 0 from ordered;

  get diagnostics inserted_count = row_count;
  if inserted_count < 2 then
    delete from public.date_match_decks where id = target_deck;
    raise exception 'Not enough public locations were available.';
  end if;

  return jsonb_build_object('deckId', target_deck, 'token', raw_token, 'itemCount', inserted_count, 'mode', deck_mode, 'maxMembers', safe_limit);
end;
$$;

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
  actor_name text;
begin
  if actor is null then raise exception 'Authentication required.'; end if;
  if invite_token is null or char_length(trim(invite_token)) < 32 then raise exception 'Shared deck link is invalid.'; end if;

  select * into target from public.date_match_decks
  where invite_token_hash = encode(digest(trim(invite_token), 'sha256'), 'hex')
    and expires_at > now() and status <> 'archived'
  for update;
  if target.id is null then raise exception 'Shared deck link is invalid or expired.'; end if;

  select role into member_role from public.date_match_members where deck_id = target.id and profile_id = actor;
  if member_role is null then
    select count(*) into member_count from public.date_match_members where deck_id = target.id;
    if member_count >= target.max_members then raise exception 'This shared deck is already full.'; end if;
    insert into public.date_match_members(deck_id, profile_id, role) values (target.id, actor, 'partner');
    member_role := 'partner';
    select coalesce(display_name, username, 'Someone') into actor_name from public.profiles where id = actor;
    insert into public.app_notifications(profile_id, kind, title, body, href, metadata)
    select m.profile_id, 'group_joined',
      case when target.mode = 'hangout' then 'Someone joined your Hangout Match' else 'Your DateMatch partner joined' end,
      coalesce(actor_name, 'Someone') || ' can now choose from the shared location deck.',
      '/dashboard', jsonb_build_object('deckId', target.id, 'mode', target.mode)
    from public.date_match_members m where m.deck_id = target.id and m.profile_id <> actor;
  end if;

  select count(*) into member_count from public.date_match_members where deck_id = target.id;
  return jsonb_build_object('deckId', target.id, 'role', member_role, 'mode', target.mode, 'maxMembers', target.max_members, 'memberCount', member_count);
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
  match_strength integer;
  own_progress integer;
  item_count integer;
  member_count integer;
  completed_members integer;
  positive_count integer;
  perfect_count integer;
  pass_count integer;
  positive_threshold integer;
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

  positive_threshold := case when target_mode = 'date' then 2 else greatest(2, ceil(member_count * 0.6)::integer) end;
  select exists (select 1 from public.date_match_matches where deck_id = target_deck and location_id = target_location) into was_match;
  did_match := member_count >= 2 and pass_count = 0 and positive_count >= positive_threshold;
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
  if member_count >= 2 and completed_members = member_count then
    update public.date_match_decks set status = case when status = 'planned' then status else 'completed' end, updated_at = now() where id = target_deck;
  end if;

  perform public.record_recommendation_context_v1(target_location, swipe_choice, target_mode, null, jsonb_build_object('shared', true), target_deck);

  return jsonb_build_object(
    'matched', did_match, 'newMatch', created_match, 'strength', match_strength,
    'progress', own_progress, 'itemCount', item_count, 'memberCount', member_count,
    'completedMembers', completed_members, 'positiveCount', positive_count,
    'perfectCount', perfect_count, 'passCount', pass_count, 'mode', target_mode
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
  insert into public.app_notifications(profile_id, kind, title, body, href, metadata)
  select m.profile_id, 'plan_scheduled', 'A location plan was scheduled',
    l.name || ' is planned for ' || to_char(planned_time at time zone 'UTC', 'Mon DD at HH12:MI AM') || '.',
    '/plans?tab=planned', jsonb_build_object('deckId', target_deck, 'locationId', target_location, 'plannedFor', planned_time, 'mode', target_mode)
  from public.date_match_members m cross join public.locations l where m.deck_id = target_deck and l.id = target_location;
  perform public.record_recommendation_context_v1(target_location, 'planned', coalesce(target_mode, 'date'), null, jsonb_build_object('shared', true), target_deck);
  return jsonb_build_object('plannedFor', planned_time);
end;
$$;

create or replace function public.record_date_match_feedback_v1(target_deck uuid, target_location uuid, did_happen boolean, date_rating text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare actor uuid := auth.uid(); target_mode text; event_name text;
begin
  if actor is null then raise exception 'Authentication required.'; end if;
  if not public.is_date_match_member(target_deck) then raise exception 'Shared deck membership required.'; end if;
  if did_happen and coalesce(date_rating, '') not in ('great','okay','not_for_us') then raise exception 'Choose how the location worked.'; end if;
  insert into public.date_match_feedback(deck_id, location_id, profile_id, happened, rating, updated_at)
  values (target_deck, target_location, actor, did_happen, case when did_happen then date_rating else null end, now())
  on conflict (deck_id, location_id, profile_id) do update set happened = excluded.happened, rating = excluded.rating, updated_at = now();
  if did_happen then update public.date_match_matches set status = 'happened', updated_at = now() where deck_id = target_deck and location_id = target_location; end if;
  select mode into target_mode from public.date_match_decks where id = target_deck;
  if did_happen then
    perform public.record_recommendation_context_v1(target_location, 'visited', coalesce(target_mode, 'date'), null, jsonb_build_object('shared', true), target_deck);
    event_name := date_rating;
    perform public.record_recommendation_context_v1(target_location, event_name, coalesce(target_mode, 'date'), null, jsonb_build_object('shared', true), target_deck);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.record_recommendation_context_v1(uuid, text, text, text, jsonb, uuid) from public;
revoke all on function public.recommendation_context_scores_v1(text, text, boolean) from public;
revoke all on function public.create_shared_location_deck_v2(uuid[], double precision, double precision, text, integer, jsonb) from public;
grant execute on function public.record_recommendation_context_v1(uuid, text, text, text, jsonb, uuid) to authenticated;
grant execute on function public.recommendation_context_scores_v1(text, text, boolean) to authenticated;
grant execute on function public.create_shared_location_deck_v2(uuid[], double precision, double precision, text, integer, jsonb) to authenticated;
