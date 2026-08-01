create extension if not exists pgcrypto with schema extensions;

create table if not exists public.date_match_decks (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  invite_token_hash text not null unique,
  title text,
  status text not null default 'open' check (status in ('open','completed','planned','archived')),
  center_latitude double precision,
  center_longitude double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create table if not exists public.date_match_members (
  deck_id uuid not null references public.date_match_decks(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('creator','partner')),
  joined_at timestamptz not null default now(),
  primary key (deck_id, profile_id)
);

create table if not exists public.date_match_items (
  deck_id uuid not null references public.date_match_decks(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  sort_order integer not null default 0 check (sort_order >= 0 and sort_order < 12),
  is_puddle_pick boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (deck_id, location_id),
  unique (deck_id, sort_order)
);

create table if not exists public.date_match_swipes (
  deck_id uuid not null references public.date_match_decks(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  choice text not null check (choice in ('pass','save','perfect')),
  note text check (note is null or char_length(note) <= 280),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (deck_id, profile_id, location_id),
  foreign key (deck_id, location_id) references public.date_match_items(deck_id, location_id) on delete cascade
);

create table if not exists public.date_match_matches (
  deck_id uuid not null references public.date_match_decks(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  strength smallint not null default 2 check (strength between 2 and 4),
  status text not null default 'matched' check (status in ('matched','planned','happened')),
  matched_at timestamptz not null default now(),
  planned_for timestamptz,
  updated_at timestamptz not null default now(),
  primary key (deck_id, location_id),
  foreign key (deck_id, location_id) references public.date_match_items(deck_id, location_id) on delete cascade
);

create table if not exists public.date_match_feedback (
  deck_id uuid not null,
  location_id uuid not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  happened boolean not null,
  rating text check (rating is null or rating in ('great','okay','not_for_us')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (deck_id, location_id, profile_id),
  foreign key (deck_id, location_id) references public.date_match_matches(deck_id, location_id) on delete cascade
);

create index if not exists date_match_members_profile_idx on public.date_match_members(profile_id, joined_at desc);
create index if not exists date_match_swipes_deck_location_idx on public.date_match_swipes(deck_id, location_id);
create index if not exists date_match_matches_planned_idx on public.date_match_matches(planned_for) where planned_for is not null;

create or replace function public.is_date_match_member(target_deck uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.date_match_members
    where deck_id = target_deck and profile_id = auth.uid()
  );
$$;

alter table public.date_match_decks enable row level security;
alter table public.date_match_members enable row level security;
alter table public.date_match_items enable row level security;
alter table public.date_match_swipes enable row level security;
alter table public.date_match_matches enable row level security;
alter table public.date_match_feedback enable row level security;

create policy date_match_decks_read on public.date_match_decks
  for select to authenticated using (public.is_date_match_member(id));
create policy date_match_members_read on public.date_match_members
  for select to authenticated using (public.is_date_match_member(deck_id));
create policy date_match_items_read on public.date_match_items
  for select to authenticated using (public.is_date_match_member(deck_id));
create policy date_match_swipes_read_own on public.date_match_swipes
  for select to authenticated using (profile_id = auth.uid());
create policy date_match_matches_read on public.date_match_matches
  for select to authenticated using (public.is_date_match_member(deck_id));
create policy date_match_feedback_read_own on public.date_match_feedback
  for select to authenticated using (profile_id = auth.uid());

grant select on public.date_match_decks, public.date_match_members, public.date_match_items, public.date_match_swipes, public.date_match_matches, public.date_match_feedback to authenticated;

create or replace function public.create_date_match_v1(
  location_ids uuid[],
  center_lat double precision default null,
  center_lng double precision default null
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
begin
  if actor is null then raise exception 'Authentication required.'; end if;
  if location_ids is null or cardinality(location_ids) < 2 then raise exception 'At least two locations are required.'; end if;
  if center_lat is not null and (center_lat < -90 or center_lat > 90) then raise exception 'Latitude is invalid.'; end if;
  if center_lng is not null and (center_lng < -180 or center_lng > 180) then raise exception 'Longitude is invalid.'; end if;

  insert into public.date_match_decks(created_by, invite_token_hash, center_latitude, center_longitude)
  values (actor, encode(digest(raw_token, 'sha256'), 'hex'), center_lat, center_lng)
  returning id into target_deck;

  insert into public.date_match_members(deck_id, profile_id, role)
  values (target_deck, actor, 'creator');

  with valid as (
    select l.id, min(input.ordinality) as first_position
    from unnest(location_ids) with ordinality as input(location_id, ordinality)
    join public.locations l on l.id = input.location_id
    where l.status = 'published'
      and l.visibility = 'public'
      and coalesce(l.has_private_address, false) = false
    group by l.id
    order by min(input.ordinality)
    limit 12
  ), ordered as (
    select id, row_number() over (order by first_position) - 1 as position
    from valid
  )
  insert into public.date_match_items(deck_id, location_id, sort_order, is_puddle_pick)
  select target_deck, id, position, position = 0 from ordered;

  get diagnostics inserted_count = row_count;
  if inserted_count < 2 then
    delete from public.date_match_decks where id = target_deck;
    raise exception 'Not enough public locations were available.';
  end if;

  return jsonb_build_object('deckId', target_deck, 'token', raw_token, 'itemCount', inserted_count);
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
begin
  if actor is null then raise exception 'Authentication required.'; end if;
  if invite_token is null or char_length(trim(invite_token)) < 32 then raise exception 'DateMatch link is invalid.'; end if;

  select * into target
  from public.date_match_decks
  where invite_token_hash = encode(digest(trim(invite_token), 'sha256'), 'hex')
    and expires_at > now()
    and status <> 'archived'
  for update;

  if target.id is null then raise exception 'DateMatch link is invalid or expired.'; end if;

  select role into member_role from public.date_match_members
  where deck_id = target.id and profile_id = actor;

  if member_role is null then
    select count(*) into member_count from public.date_match_members where deck_id = target.id;
    if member_count >= 2 then raise exception 'This DateMatch already has two people.'; end if;
    insert into public.date_match_members(deck_id, profile_id, role)
    values (target.id, actor, 'partner');
    member_role := 'partner';
  end if;

  return jsonb_build_object('deckId', target.id, 'role', member_role);
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
  partner_choice text;
  partner_note text;
  match_strength integer;
  own_progress integer;
  item_count integer;
  member_count integer;
  total_swipes integer;
  did_match boolean := false;
begin
  if actor is null then raise exception 'Authentication required.'; end if;
  if swipe_choice not in ('pass','save','perfect') then raise exception 'Swipe choice is invalid.'; end if;
  if not public.is_date_match_member(target_deck) then raise exception 'DateMatch membership required.'; end if;
  if not exists (select 1 from public.date_match_items where deck_id = target_deck and location_id = target_location) then raise exception 'Location is not in this deck.'; end if;

  insert into public.date_match_swipes(deck_id, profile_id, location_id, choice, note, updated_at)
  values (target_deck, actor, target_location, swipe_choice, nullif(left(trim(coalesce(swipe_note, '')), 280), ''), now())
  on conflict (deck_id, profile_id, location_id) do update
    set choice = excluded.choice, note = excluded.note, updated_at = now();

  select choice, note into partner_choice, partner_note
  from public.date_match_swipes
  where deck_id = target_deck
    and location_id = target_location
    and profile_id <> actor
    and choice in ('save','perfect')
  limit 1;

  if swipe_choice in ('save','perfect') and partner_choice is not null then
    match_strength := 2 + case when swipe_choice = 'perfect' then 1 else 0 end + case when partner_choice = 'perfect' then 1 else 0 end;
    insert into public.date_match_matches(deck_id, location_id, strength, matched_at, updated_at)
    values (target_deck, target_location, match_strength, now(), now())
    on conflict (deck_id, location_id) do update
      set strength = excluded.strength, updated_at = now();
    did_match := true;
  else
    delete from public.date_match_matches where deck_id = target_deck and location_id = target_location;
  end if;

  select count(*) into own_progress from public.date_match_swipes where deck_id = target_deck and profile_id = actor;
  select count(*) into item_count from public.date_match_items where deck_id = target_deck;
  select count(*) into member_count from public.date_match_members where deck_id = target_deck;
  select count(*) into total_swipes from public.date_match_swipes where deck_id = target_deck;

  if member_count = 2 and total_swipes >= item_count * 2 then
    update public.date_match_decks set status = case when status = 'planned' then status else 'completed' end, updated_at = now() where id = target_deck;
  end if;

  return jsonb_build_object(
    'matched', did_match,
    'strength', match_strength,
    'partnerNote', case when did_match then partner_note else null end,
    'progress', own_progress,
    'itemCount', item_count
  );
end;
$$;

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
  if planned_time is null then raise exception 'Choose a date and time.'; end if;

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
  if did_happen and date_rating not in ('great','okay','not_for_us') then raise exception 'Choose how the date location worked.'; end if;

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

create or replace function public.date_match_reveals_v1(target_deck uuid)
returns table(location_id uuid, choice text, note text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_date_match_member(target_deck) then return; end if;
  return query
    select s.location_id, s.choice, s.note
    from public.date_match_swipes s
    join public.date_match_matches m on m.deck_id = s.deck_id and m.location_id = s.location_id
    where s.deck_id = target_deck and s.profile_id <> auth.uid();
end;
$$;

grant execute on function public.is_date_match_member(uuid) to authenticated;
grant execute on function public.create_date_match_v1(uuid[], double precision, double precision) to authenticated;
grant execute on function public.join_date_match_v1(text) to authenticated;
grant execute on function public.record_date_match_swipe_v1(uuid, uuid, text, text) to authenticated;
grant execute on function public.schedule_date_match_v1(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.record_date_match_feedback_v1(uuid, uuid, boolean, text) to authenticated;
grant execute on function public.date_match_reveals_v1(uuid) to authenticated;
