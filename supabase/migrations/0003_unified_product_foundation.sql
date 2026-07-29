-- Stage 1: one Puddle user model, optional host profiles, locations, and unified content states.
-- Apply after 0001_puddle_core.sql and 0002_authentication.sql.

alter table public.profiles add column if not exists account_kind text not null default 'user';
do $$ begin
  if not exists (select 1 from pg_constraint where conname='profiles_one_account_kind') then
    alter table public.profiles add constraint profiles_one_account_kind check (account_kind='user');
  end if;
end $$;

create table if not exists public.content_categories (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  label text not null check (char_length(label) between 2 and 50),
  content_kind text not null check (content_kind in ('event','location','both')),
  icon text,
  sort_order integer not null default 0,
  active boolean not null default true
);

insert into public.content_categories (slug,label,content_kind,icon,sort_order) values
  ('live-music','Live music','both','♫',10),
  ('food-drink','Food & drink','both','✦',20),
  ('arts-culture','Arts & culture','both','◇',30),
  ('outdoors','Outdoors','both','☀',40),
  ('sports','Sports','both','●',50),
  ('workshops','Workshops','event','✎',60),
  ('nightlife','Nightlife','both','☾',70),
  ('cafes','Cafés','location','☕',80),
  ('parks','Parks','location','♧',90),
  ('local-gems','Local gems','location','⌖',100)
on conflict (slug) do update set label=excluded.label, content_kind=excluded.content_kind, icon=excluded.icon, sort_order=excluded.sort_order;

create table if not exists public.host_profiles (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('personal','club','venue','business','community_group')),
  name text not null check (char_length(name) between 2 and 100),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,80}$'),
  description text check (char_length(description) <= 1200),
  logo_path text,
  city text,
  website_url text,
  verification_status text not null default 'unverified' check (verification_status in ('unverified','pending','verified','rejected','suspended')),
  status text not null default 'active' check (status in ('active','hidden','suspended','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists host_profiles_created_by_idx on public.host_profiles(created_by,created_at desc);
create index if not exists host_profiles_status_idx on public.host_profiles(status,verification_status);

create table if not exists public.host_members (
  host_profile_id uuid not null references public.host_profiles(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner','editor','checkin','moderator','finance')),
  invited_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (host_profile_id,profile_id)
);
create index if not exists host_members_profile_idx on public.host_members(profile_id,role);

create or replace function public.add_host_owner()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.host_members(host_profile_id,profile_id,role,invited_by,accepted_at)
  values(new.id,new.created_by,'owner',new.created_by,now())
  on conflict (host_profile_id,profile_id) do update set role='owner',accepted_at=coalesce(public.host_members.accepted_at,now());
  return new;
end;
$$;
drop trigger if exists host_profiles_add_owner on public.host_profiles;
create trigger host_profiles_add_owner after insert on public.host_profiles for each row execute function public.add_host_owner();

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id) on delete set null,
  host_profile_id uuid references public.host_profiles(id) on delete set null,
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,100}$'),
  kind text not null check (kind in ('cafe','restaurant','bar','park','museum','gallery','attraction','activity_venue','study_spot','scenic_spot','nightlife','shop','community_space','other')),
  summary text check (char_length(summary) <= 500),
  description text check (char_length(description) <= 5000),
  city text not null,
  neighborhood text,
  address_public text,
  point geography(point,4326),
  timezone text not null default 'America/Toronto',
  opening_hours jsonb not null default '{}'::jsonb,
  amenities text[] not null default '{}',
  accessibility jsonb not null default '{}'::jsonb,
  price_level smallint check (price_level between 1 and 4),
  cover_path text,
  status text not null default 'draft' check (status in ('draft','pending_review','published','rejected','suspended','archived')),
  source text not null default 'user' check (source in ('user','host','seed','import')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists locations_point_gix on public.locations using gist(point);
create index if not exists locations_status_city_idx on public.locations(status,city);
create index if not exists locations_host_idx on public.locations(host_profile_id) where host_profile_id is not null;

alter table public.events add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.events add column if not exists host_profile_id uuid references public.host_profiles(id) on delete set null;
alter table public.events add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.events alter column organizer_id drop not null;
update public.events e set created_by=o.owner_id from public.organizers o where e.organizer_id=o.id and e.created_by is null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='events_unified_creator_required') then
    alter table public.events add constraint events_unified_creator_required check (created_by is not null or host_profile_id is not null or organizer_id is not null);
  end if;
end $$;
create index if not exists events_created_by_idx on public.events(created_by,created_at desc) where created_by is not null;
create index if not exists events_host_profile_idx on public.events(host_profile_id,status,starts_at) where host_profile_id is not null;
create index if not exists events_location_idx on public.events(location_id,starts_at) where location_id is not null;

create table if not exists public.event_permissions (
  event_id uuid not null references public.events(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner','editor','checkin','moderator','finance')),
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(event_id,profile_id)
);
create index if not exists event_permissions_profile_idx on public.event_permissions(profile_id,role);

create table if not exists public.user_content_states (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  state text not null check (state in ('saved','interested','attending','visited','hosting')),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint one_content_target check (num_nonnulls(event_id,location_id)=1),
  constraint hosting_is_event_only check (state<>'hosting' or event_id is not null)
);
create unique index if not exists user_event_state_unique on public.user_content_states(profile_id,event_id,state) where event_id is not null;
create unique index if not exists user_location_state_unique on public.user_content_states(profile_id,location_id,state) where location_id is not null;
create index if not exists user_content_states_profile_idx on public.user_content_states(profile_id,state,created_at desc);

create or replace function public.is_host_member(target uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.host_members hm where hm.host_profile_id=target and hm.profile_id=auth.uid() and hm.accepted_at is not null)
$$;

create or replace function public.has_host_role(target uuid, allowed text[])
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.host_members hm where hm.host_profile_id=target and hm.profile_id=auth.uid() and hm.accepted_at is not null and hm.role=any(allowed))
$$;

create or replace function public.can_manage_event(target uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.events e
    where e.id=target and (
      e.created_by=auth.uid()
      or (e.host_profile_id is not null and public.has_host_role(e.host_profile_id,array['owner','editor']))
      or exists(select 1 from public.event_permissions ep where ep.event_id=e.id and ep.profile_id=auth.uid() and ep.role in ('owner','editor'))
      or public.is_admin()
    )
  )
$$;

create or replace function public.touch_stage_one_updated_at()
returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists host_profiles_touch_updated_at on public.host_profiles;
create trigger host_profiles_touch_updated_at before update on public.host_profiles for each row execute function public.touch_stage_one_updated_at();
drop trigger if exists locations_touch_updated_at on public.locations;
create trigger locations_touch_updated_at before update on public.locations for each row execute function public.touch_stage_one_updated_at();
drop trigger if exists user_content_states_touch_updated_at on public.user_content_states;
create trigger user_content_states_touch_updated_at before update on public.user_content_states for each row execute function public.touch_stage_one_updated_at();

alter table public.content_categories enable row level security;
alter table public.host_profiles enable row level security;
alter table public.host_members enable row level security;
alter table public.locations enable row level security;
alter table public.event_permissions enable row level security;
alter table public.user_content_states enable row level security;

create policy "categories are public" on public.content_categories for select using (active=true);
create policy "host profiles visible" on public.host_profiles for select using (status='active' or created_by=auth.uid() or public.is_host_member(id) or public.is_admin());
create policy "users create host profiles" on public.host_profiles for insert with check (created_by=auth.uid());
create policy "host owners update profiles" on public.host_profiles for update using (created_by=auth.uid() or public.has_host_role(id,array['owner']) or public.is_admin()) with check (created_by=auth.uid() or public.has_host_role(id,array['owner']) or public.is_admin());
create policy "host owners delete profiles" on public.host_profiles for delete using (created_by=auth.uid() or public.has_host_role(id,array['owner']) or public.is_admin());
create policy "host members visible to members" on public.host_members for select using (profile_id=auth.uid() or public.is_host_member(host_profile_id) or public.is_admin());
create policy "host owners add members" on public.host_members for insert with check (public.has_host_role(host_profile_id,array['owner']) or public.is_admin());
create policy "host owners update members" on public.host_members for update using (public.has_host_role(host_profile_id,array['owner']) or public.is_admin()) with check (public.has_host_role(host_profile_id,array['owner']) or public.is_admin());
create policy "host owners remove members" on public.host_members for delete using (public.has_host_role(host_profile_id,array['owner']) or public.is_admin());
create policy "published locations public read" on public.locations for select using (status='published' or created_by=auth.uid() or (host_profile_id is not null and public.is_host_member(host_profile_id)) or public.is_admin());
create policy "users create locations" on public.locations for insert with check (created_by=auth.uid() and (host_profile_id is null or public.has_host_role(host_profile_id,array['owner','editor'])));
create policy "location creators manage" on public.locations for update using (created_by=auth.uid() or (host_profile_id is not null and public.has_host_role(host_profile_id,array['owner','editor'])) or public.is_admin()) with check (created_by=auth.uid() or (host_profile_id is not null and public.has_host_role(host_profile_id,array['owner','editor'])) or public.is_admin());
create policy "event permissions visible" on public.event_permissions for select using (profile_id=auth.uid() or public.can_manage_event(event_id) or public.is_admin());
create policy "event owners manage permissions" on public.event_permissions for all using (public.can_manage_event(event_id) or public.is_admin()) with check (public.can_manage_event(event_id) or public.is_admin());
create policy "own unified content states" on public.user_content_states for all using (profile_id=auth.uid()) with check (profile_id=auth.uid());
create policy "unified event creators manage" on public.events for all using (created_by=auth.uid() or (host_profile_id is not null and public.has_host_role(host_profile_id,array['owner','editor'])) or public.can_manage_event(id)) with check (created_by=auth.uid() or (host_profile_id is not null and public.has_host_role(host_profile_id,array['owner','editor'])) or public.can_manage_event(id));

grant select on public.content_categories to anon, authenticated;
grant select on public.locations to anon, authenticated;
grant insert,update,delete on public.locations to authenticated;
grant select,insert,update,delete on public.host_profiles,public.host_members,public.event_permissions,public.user_content_states to authenticated;

insert into public.locations (name,slug,kind,summary,city,neighborhood,address_public,point,amenities,price_level,status,source) values
  ('Moonlight Café','moonlight-cafe','cafe','Late-night espresso, vinyl, and soft lights.','Toronto','Kensington Market','Kensington Market, Toronto',st_setsrid(st_makepoint(-79.4023,43.6547),4326)::geography,array['wifi','late-night','outlets'],2,'published','seed'),
  ('Sunset Steps','sunset-steps','scenic_spot','A west-facing lookout made for golden hour.','Toronto','Riverdale','Riverdale, Toronto',st_setsrid(st_makepoint(-79.3540,43.6700),4326)::geography,array['outdoors','free','views'],1,'published','seed'),
  ('Laneway Gallery','laneway-gallery','gallery','Tiny rotating exhibits hidden behind a colourful laneway.','Toronto','West Queen West','West Queen West, Toronto',st_setsrid(st_makepoint(-79.4167,43.6465),4326)::geography,array['art','independent','accessible'],2,'published','seed'),
  ('Harbour Activity Deck','harbour-activity-deck','activity_venue','Outdoor games, classes, and waterfront pop-ups.','Toronto','Harbourfront','Harbourfront, Toronto',st_setsrid(st_makepoint(-79.3816,43.6387),4326)::geography,array['waterfront','activities','transit'],2,'published','seed')
on conflict (slug) do update set summary=excluded.summary,point=excluded.point,amenities=excluded.amenities,status='published';
