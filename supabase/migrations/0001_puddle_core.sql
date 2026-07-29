-- Puddle production schema foundation. Test in staging before applying.
create extension if not exists pgcrypto;
create extension if not exists postgis;

create type public.account_role as enum ('attendee','organizer','moderator','admin','support','finance');
create type public.event_status as enum ('draft','pending_review','scheduled','published','sold_out','cancelled','postponed','completed','rejected','suspended','archived');
create type public.swipe_direction as enum ('left','right','more_like_this','less_like_this');
create type public.visibility_level as enum ('hidden','friends','mutuals','attendees','public');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.account_role not null default 'attendee',
  display_name text not null check (char_length(display_name) between 1 and 60),
  username text unique check (username ~ '^[a-z0-9_]{3,24}$'),
  birth_date date,
  age_verified_at timestamptz,
  city text,
  home_point geography(point,4326),
  search_radius_km integer not null default 10 check (search_radius_km between 1 and 100),
  bio text check (char_length(bio) <= 500),
  avatar_path text,
  profile_visibility public.visibility_level not null default 'friends',
  social_matching_enabled boolean not null default false,
  dating_enabled boolean not null default false,
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dating_requires_adult check (not dating_enabled or birth_date <= current_date - interval '18 years')
);

create table public.organizers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  public_name text not null,
  legal_name text,
  slug text not null unique,
  description text,
  website_url text,
  avatar_path text,
  verification_status text not null default 'draft' check (verification_status in ('draft','submitted','under_review','verified','rejected','suspended','additional_information_required')),
  verified_at timestamptz,
  payout_account_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizer_members (
  organizer_id uuid not null references public.organizers(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null check (member_role in ('owner','manager','editor','checkin','support')),
  created_at timestamptz not null default now(),
  primary key (organizer_id, profile_id)
);

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid references public.organizers(id),
  name text not null,
  address_public text,
  address_private text,
  point geography(point,4326) not null,
  timezone text not null default 'America/Toronto',
  accessibility jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index venues_point_gix on public.venues using gist(point);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.organizers(id),
  venue_id uuid references public.venues(id),
  title text not null check (char_length(title) between 3 and 120),
  slug text not null unique,
  summary text check (char_length(summary) <= 280),
  description text,
  category text not null,
  status public.event_status not null default 'draft',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'America/Toronto',
  min_age smallint check (min_age between 0 and 99),
  capacity integer check (capacity is null or capacity > 0),
  price_from_cents integer not null default 0 check (price_from_cents >= 0),
  currency char(3) not null default 'CAD',
  cover_path text,
  exact_address_after_rsvp boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_event_time check (ends_at > starts_at)
);
create index events_status_starts_idx on public.events(status, starts_at);

create table public.event_swipes (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  direction public.swipe_direction not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id,event_id)
);

create table public.event_saves (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id,event_id)
);

create table public.event_rsvps (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  status text not null default 'interested' check (status in ('interested','going','waitlisted','cancelled','checked_in')),
  visibility public.visibility_level not null default 'hidden',
  allow_profile_discovery boolean not null default false,
  allow_messages_from_attendees boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id,event_id)
);

create table public.friendships (
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending','accepted','declined','removed')),
  created_at timestamptz not null default now(),
  primary key (requester_id,addressee_id),
  constraint no_self_friend check (requester_id <> addressee_id)
);

create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id,blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);

create table public.profile_swipes (
  swiper_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  intent text not null check (intent in ('friends','networking','dating')),
  liked boolean not null,
  created_at timestamptz not null default now(),
  primary key (swiper_id,target_id,event_id),
  constraint no_self_profile_swipe check (swiper_id <> target_id)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  profile_a uuid not null references public.profiles(id) on delete cascade,
  profile_b uuid not null references public.profiles(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  intent text not null check (intent in ('friends','networking','dating')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint ordered_match check (profile_a < profile_b),
  unique(profile_a,profile_b,event_id,intent)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete set null,
  kind text not null check (kind in ('direct','match','event_room','organizer','support')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('member','moderator','owner')),
  joined_at timestamptz not null default now(),
  primary key (conversation_id,profile_id)
);
create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 5000),
  state text not null default 'visible' check (state in ('visible','author_deleted','moderator_removed')),
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages(conversation_id,created_at desc);

create table public.ticket_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  price_cents integer not null check (price_cents >= 0),
  quantity_total integer not null check (quantity_total >= 0),
  quantity_sold integer not null default 0 check (quantity_sold between 0 and quantity_total),
  sales_start timestamptz,
  sales_end timestamptz
);
create table public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  ticket_type_id uuid not null references public.ticket_types(id) on delete cascade,
  profile_id uuid references public.profiles(id),
  quantity integer not null check (quantity > 0),
  checkout_session_id text unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid references public.profiles(id),
  event_id uuid not null references public.events(id),
  stripe_checkout_session_id text unique,
  status text not null default 'pending' check (status in ('pending','payment_processing','paid','payment_failed','partially_refunded','refunded','disputed','cancelled','expired')),
  amount_total_cents integer not null check (amount_total_cents >= 0),
  currency char(3) not null default 'CAD',
  created_at timestamptz not null default now()
);
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  ticket_type_id uuid not null references public.ticket_types(id),
  owner_id uuid references public.profiles(id),
  signed_code_hash text not null unique,
  status text not null default 'valid' check (status in ('valid','transferred','checked_in','refunded','void')),
  checked_in_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.location_sharing_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null check (purpose in ('event','journey','meetup')),
  precision text not null check (precision in ('approximate','precise')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  stopped_at timestamptz,
  constraint valid_location_window check (expires_at > starts_at and expires_at <= starts_at + interval '8 hours')
);
create table public.location_session_viewers (
  session_id uuid not null references public.location_sharing_sessions(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  primary key(session_id,viewer_id)
);
create table public.ephemeral_location_points (
  session_id uuid primary key references public.location_sharing_sessions(id) on delete cascade,
  point geography(point,4326) not null,
  accuracy_meters real,
  recorded_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id),
  target_type text not null,
  target_id text not null,
  category text not null,
  details text,
  state text not null default 'open' check (state in ('open','triaged','investigating','actioned','dismissed','appealed')),
  created_at timestamptz not null default now()
);
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  target_type text not null,
  target_id text,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','moderator') and suspended_at is null)
$$;
create or replace function public.is_organizer_member(target uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.organizer_members where organizer_id=target and profile_id=auth.uid())
$$;

alter table public.profiles enable row level security;
alter table public.organizers enable row level security;
alter table public.organizer_members enable row level security;
alter table public.venues enable row level security;
alter table public.events enable row level security;
alter table public.event_swipes enable row level security;
alter table public.event_saves enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.friendships enable row level security;
alter table public.blocks enable row level security;
alter table public.profile_swipes enable row level security;
alter table public.matches enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.orders enable row level security;
alter table public.tickets enable row level security;
alter table public.location_sharing_sessions enable row level security;
alter table public.location_session_viewers enable row level security;
alter table public.ephemeral_location_points enable row level security;
alter table public.reports enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles self read" on public.profiles for select using (id=auth.uid() or public.is_admin());
create policy "profiles self update" on public.profiles for update using (id=auth.uid()) with check (id=auth.uid());
create policy "published events public read" on public.events for select using (status='published' or public.is_organizer_member(organizer_id) or public.is_admin());
create policy "organizer members manage events" on public.events for all using (public.is_organizer_member(organizer_id) or public.is_admin()) with check (public.is_organizer_member(organizer_id) or public.is_admin());
create policy "own swipes" on public.event_swipes for all using (profile_id=auth.uid()) with check (profile_id=auth.uid());
create policy "own saves" on public.event_saves for all using (profile_id=auth.uid()) with check (profile_id=auth.uid());
create policy "own rsvps" on public.event_rsvps for all using (profile_id=auth.uid() or public.is_admin()) with check (profile_id=auth.uid() or public.is_admin());
create policy "friendship participants" on public.friendships for all using (requester_id=auth.uid() or addressee_id=auth.uid()) with check (requester_id=auth.uid() or addressee_id=auth.uid());
create policy "own blocks" on public.blocks for all using (blocker_id=auth.uid()) with check (blocker_id=auth.uid());
create policy "own profile swipes" on public.profile_swipes for all using (swiper_id=auth.uid()) with check (swiper_id=auth.uid());
create policy "match participants" on public.matches for select using (profile_a=auth.uid() or profile_b=auth.uid() or public.is_admin());
create policy "conversation participants" on public.conversations for select using (exists(select 1 from public.conversation_members cm where cm.conversation_id=id and cm.profile_id=auth.uid()) or public.is_admin());
create policy "messages visible to members" on public.messages for select using (exists(select 1 from public.conversation_members cm where cm.conversation_id=conversation_id and cm.profile_id=auth.uid()) or public.is_admin());
create policy "members send messages" on public.messages for insert with check (sender_id=auth.uid() and exists(select 1 from public.conversation_members cm where cm.conversation_id=conversation_id and cm.profile_id=auth.uid()));
create policy "buyers read orders" on public.orders for select using (buyer_id=auth.uid() or public.is_admin());
create policy "ticket owners read tickets" on public.tickets for select using (owner_id=auth.uid() or public.is_admin());
create policy "location owners manage sessions" on public.location_sharing_sessions for all using (owner_id=auth.uid()) with check (owner_id=auth.uid());
create policy "authorized location points" on public.ephemeral_location_points for select using (exists(select 1 from public.location_sharing_sessions s where s.id=session_id and s.stopped_at is null and s.expires_at>now() and (s.owner_id=auth.uid() or exists(select 1 from public.location_session_viewers v where v.session_id=s.id and v.viewer_id=auth.uid()))));
create policy "users create reports" on public.reports for insert with check (reporter_id=auth.uid());
create policy "users read own reports" on public.reports for select using (reporter_id=auth.uid() or public.is_admin());
create policy "admins read audit logs" on public.audit_logs for select using (public.is_admin());
