-- Stage 4: RSVPs, capacity, waitlists, visits, shared plans, polls, itinerary, and plan chat.
-- Apply after 0008_secure_media_and_discovery.sql.

alter table public.event_rsvps add column if not exists guest_count integer not null default 1 check (guest_count between 1 and 10);
alter table public.event_rsvps add column if not exists answers jsonb not null default '{}'::jsonb;
alter table public.event_rsvps add column if not exists requested_at timestamptz;
alter table public.event_rsvps add column if not exists approved_at timestamptz;
alter table public.event_rsvps add column if not exists declined_at timestamptz;
alter table public.event_rsvps add column if not exists cancelled_at timestamptz;
alter table public.event_rsvps add column if not exists checked_in_at timestamptz;
alter table public.event_rsvps add column if not exists checkin_by uuid references public.profiles(id) on delete set null;
alter table public.event_rsvps add column if not exists waitlist_position bigint;
alter table public.event_rsvps add column if not exists source text not null default 'puddle' check (source in ('puddle','host','import'));
alter table public.event_rsvps drop constraint if exists event_rsvps_status_check;
alter table public.event_rsvps add constraint event_rsvps_status_check check (status in ('interested','requested','going','waitlisted','declined','cancelled','checked_in'));
create index if not exists event_rsvps_capacity_idx on public.event_rsvps(event_id,status,created_at);
create unique index if not exists event_waitlist_position_unique on public.event_rsvps(event_id,waitlist_position) where status='waitlisted';

create table public.event_checkins (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  checked_in_by uuid not null references public.profiles(id) on delete restrict,
  source text not null default 'manual' check (source in ('manual','qr','offline_sync')),
  checked_in_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid references public.profiles(id) on delete set null,
  note text check (char_length(note)<=500)
);
create unique index active_event_checkin_unique on public.event_checkins(event_id,profile_id) where reversed_at is null;
create index event_checkins_event_idx on public.event_checkins(event_id,checked_in_at desc);

create or replace function public.can_checkin_event(target uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.events e where e.id=target and (
    public.can_manage_event(e.id)
    or (e.host_profile_id is not null and public.has_host_role(e.host_profile_id,array['owner','editor','checkin']))
    or exists(select 1 from public.event_permissions ep where ep.event_id=e.id and ep.profile_id=auth.uid() and ep.role in ('owner','editor','checkin'))
    or public.is_admin()
  ))
$$;

create or replace function public.event_used_capacity(target uuid)
returns integer language sql stable security definer set search_path=public as $$
  select coalesce(sum(guest_count),0)::integer from public.event_rsvps where event_id=target and status in ('going','checked_in')
$$;

create or replace function public.next_waitlist_position(target uuid)
returns bigint language sql volatile security definer set search_path=public as $$
  select coalesce(max(waitlist_position),0)+1 from public.event_rsvps where event_id=target
$$;

create or replace function public.request_event_attendance_v1(target uuid,attendee_answers jsonb default '{}'::jsonb,attendee_visibility text default 'hidden',requested_guests integer default 1)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();listing public.events%rowtype;person public.profiles%rowtype;used integer;next_state text;normalized_visibility public.visibility_level;position bigint;prior public.event_rsvps%rowtype;
begin
  if actor is null then raise exception 'authentication required'; end if;
  select * into listing from public.events where id=target and status='published' for update;
  if listing.id is null or listing.ends_at<=now() then raise exception 'event unavailable'; end if;
  select * into person from public.profiles where id=actor;
  if listing.min_age is not null and person.birth_date is null then raise exception 'birth date required'; end if;
  if listing.min_age is not null and person.birth_date>current_date-make_interval(years=>listing.min_age) then raise exception 'age requirement not met'; end if;
  select * into prior from public.event_rsvps where profile_id=actor and event_id=target for update;
  if prior.status='checked_in' then return jsonb_build_object('status','checked_in'); end if;
  requested_guests:=greatest(1,least(coalesce(requested_guests,1),10));
  normalized_visibility:=case when attendee_visibility in ('hidden','friends','attendees','public') then attendee_visibility::public.visibility_level else 'hidden'::public.visibility_level end;
  used:=public.event_used_capacity(target)-case when prior.status in ('going','checked_in') then coalesce(prior.guest_count,1) else 0 end;
  if listing.approval_required then next_state:='requested';
  elsif listing.capacity is not null and used+requested_guests>listing.capacity then next_state:='waitlisted';position:=public.next_waitlist_position(target);
  else next_state:='going'; end if;

  insert into public.event_rsvps(profile_id,event_id,status,visibility,guest_count,answers,requested_at,approved_at,waitlist_position,cancelled_at,declined_at,updated_at)
  values(actor,target,next_state,normalized_visibility,requested_guests,coalesce(attendee_answers,'{}'::jsonb),now(),case when next_state='going' then now() end,position,null,null,now())
  on conflict(profile_id,event_id) do update set status=excluded.status,visibility=excluded.visibility,guest_count=excluded.guest_count,answers=excluded.answers,
    requested_at=excluded.requested_at,approved_at=excluded.approved_at,waitlist_position=excluded.waitlist_position,cancelled_at=null,declined_at=null,checked_in_at=null,checkin_by=null,updated_at=now();
  delete from public.user_content_states where profile_id=actor and event_id=target and state='attending';
  if next_state='going' then insert into public.user_content_states(profile_id,event_id,state) values(actor,target,'attending'); end if;
  return jsonb_build_object('status',next_state,'waitlist_position',position,'remaining_capacity',case when listing.capacity is null then null else greatest(0,listing.capacity-public.event_used_capacity(target)) end);
end;
$$;

create or replace function public.promote_event_waitlist_v1(target uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare listing public.events%rowtype;candidate public.event_rsvps%rowtype;used integer;
begin
  select * into listing from public.events where id=target for update;
  if listing.id is null or listing.capacity is null then return null; end if;
  used:=public.event_used_capacity(target);
  select * into candidate from public.event_rsvps
    where event_id=target and status='waitlisted' and used+guest_count<=listing.capacity
    order by waitlist_position nulls last,created_at limit 1 for update skip locked;
  if candidate.profile_id is null then return null; end if;
  update public.event_rsvps set status='going',approved_at=now(),waitlist_position=null,updated_at=now() where profile_id=candidate.profile_id and event_id=target;
  delete from public.user_content_states where profile_id=candidate.profile_id and event_id=target and state='attending';
  insert into public.user_content_states(profile_id,event_id,state) values(candidate.profile_id,target,'attending');
  return candidate.profile_id;
end;
$$;

create or replace function public.promote_event_waitlist_as_manager_v1(target uuid)
returns uuid language plpgsql security definer set search_path=public as $$
begin
  if not public.can_manage_event(target) and not public.is_admin() then raise exception 'not authorized'; end if;
  perform 1 from public.events where id=target for update;
  return public.promote_event_waitlist_v1(target);
end;
$$;

create or replace function public.cancel_event_attendance_v1(target uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();prior text;promoted uuid;
begin
  if actor is null then raise exception 'authentication required'; end if;
  perform 1 from public.events where id=target for update;
  select status into prior from public.event_rsvps where profile_id=actor and event_id=target for update;
  if prior is null then return jsonb_build_object('cancelled',false); end if;
  update public.event_rsvps set status='cancelled',cancelled_at=now(),waitlist_position=null,updated_at=now() where profile_id=actor and event_id=target;
  delete from public.user_content_states where profile_id=actor and event_id=target and state='attending';
  if prior in ('going','checked_in') then promoted:=public.promote_event_waitlist_v1(target); end if;
  return jsonb_build_object('cancelled',true,'promoted_profile_id',promoted);
end;
$$;

create or replace function public.approve_event_attendance_v1(target uuid,attendee uuid,approve boolean default true)
returns jsonb language plpgsql security definer set search_path=public as $$
declare listing public.events%rowtype;reservation public.event_rsvps%rowtype;used integer;next_state text;
begin
  if not public.can_manage_event(target) and not public.is_admin() then raise exception 'not authorized'; end if;
  select * into listing from public.events where id=target for update;
  select * into reservation from public.event_rsvps where event_id=target and profile_id=attendee for update;
  if reservation.profile_id is null or reservation.status not in ('requested','waitlisted') then raise exception 'attendance request unavailable'; end if;
  if not approve then update public.event_rsvps set status='declined',declined_at=now(),waitlist_position=null,updated_at=now() where event_id=target and profile_id=attendee;return jsonb_build_object('status','declined'); end if;
  used:=public.event_used_capacity(target);
  if listing.capacity is not null and used+reservation.guest_count>listing.capacity then
    next_state:='waitlisted';
    update public.event_rsvps set status=next_state,waitlist_position=coalesce(waitlist_position,public.next_waitlist_position(target)),updated_at=now() where event_id=target and profile_id=attendee;
  else
    next_state:='going';
    update public.event_rsvps set status=next_state,approved_at=now(),waitlist_position=null,updated_at=now() where event_id=target and profile_id=attendee;
    delete from public.user_content_states where profile_id=attendee and event_id=target and state='attending';
    insert into public.user_content_states(profile_id,event_id,state) values(attendee,target,'attending');
  end if;
  return jsonb_build_object('status',next_state);
end;
$$;

create or replace function public.check_in_attendee_v1(target uuid,attendee uuid,checkin_source text default 'manual')
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();
begin
  if actor is null or not public.can_checkin_event(target) then raise exception 'not authorized'; end if;
  if checkin_source not in ('manual','qr','offline_sync') then checkin_source:='manual'; end if;
  perform 1 from public.event_rsvps where event_id=target and profile_id=attendee and status in ('going','checked_in') for update;
  if not found then raise exception 'attendee is not confirmed'; end if;
  insert into public.event_checkins(event_id,profile_id,checked_in_by,source) values(target,attendee,actor,checkin_source)
    on conflict(event_id,profile_id) where reversed_at is null do nothing;
  update public.event_rsvps set status='checked_in',checked_in_at=coalesce(checked_in_at,now()),checkin_by=actor,updated_at=now() where event_id=target and profile_id=attendee;
  return jsonb_build_object('checked_in',true);
end;
$$;

create table public.location_visits (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  status text not null default 'planned' check (status in ('planned','visited','skipped')),
  planned_for timestamptz,
  visited_at timestamptz,
  note text check (char_length(note)<=500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(profile_id,location_id)
);
create index location_visits_profile_idx on public.location_visits(profile_id,status,coalesce(planned_for,visited_at,created_at));

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 120),
  description text check (char_length(description)<=2000),
  city text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'America/Toronto',
  visibility text not null default 'invite_only' check (visibility in ('private','friends','invite_only')),
  status text not null default 'draft' check (status in ('draft','polling','finalized','completed','archived')),
  meeting_point geography(point,4326),
  meeting_latitude double precision check (meeting_latitude between -90 and 90),
  meeting_longitude double precision check (meeting_longitude between -180 and 180),
  meeting_label text check (char_length(meeting_label)<=300),
  notes text check (char_length(notes)<=3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_time_window check (ends_at is null or starts_at is null or ends_at>starts_at)
);
create index plans_owner_idx on public.plans(owner_id,status,created_at desc);
create index plans_meeting_point_gix on public.plans using gist(meeting_point);

create or replace function public.sync_plan_meeting_point()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.meeting_latitude is not null and new.meeting_longitude is not null then new.meeting_point=st_setsrid(st_makepoint(new.meeting_longitude,new.meeting_latitude),4326)::geography;
  elsif new.meeting_point is not null then new.meeting_latitude=st_y(new.meeting_point::geometry);new.meeting_longitude=st_x(new.meeting_point::geometry);
  else new.meeting_point=null; end if;
  return new;
end;
$$;
drop trigger if exists plans_sync_meeting_point on public.plans;
create trigger plans_sync_meeting_point before insert or update of meeting_latitude,meeting_longitude,meeting_point on public.plans for each row execute function public.sync_plan_meeting_point();

create table public.plan_members (
  plan_id uuid not null references public.plans(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','editor','member')),
  status text not null default 'invited' check (status in ('invited','accepted','declined','removed')),
  invited_by uuid references public.profiles(id) on delete set null,
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key(plan_id,profile_id)
);
create index plan_members_profile_idx on public.plan_members(profile_id,status,invited_at desc);

create or replace function public.add_plan_owner()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.plan_members(plan_id,profile_id,role,status,invited_by,responded_at) values(new.id,new.owner_id,'owner','accepted',new.owner_id,now());
  return new;
end;
$$;
drop trigger if exists plans_add_owner on public.plans;
create trigger plans_add_owner after insert on public.plans for each row execute function public.add_plan_owner();

create or replace function public.is_plan_member(target uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.plan_members where plan_id=target and profile_id=auth.uid() and status='accepted')
$$;
create or replace function public.can_edit_plan(target uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.plan_members where plan_id=target and profile_id=auth.uid() and status='accepted' and role in ('owner','editor')) or public.is_admin()
$$;

create or replace function public.respond_plan_invitation_v1(target uuid,response text)
returns text language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();normalized text;
begin
  if actor is null then raise exception 'authentication required'; end if;
  normalized:=case when response='accepted' then 'accepted' else 'declined' end;
  update public.plan_members set status=normalized,responded_at=now() where plan_id=target and profile_id=actor and status='invited';
  if not found then raise exception 'invitation unavailable'; end if;
  return normalized;
end;
$$;

create or replace function public.protect_plan_member_identity()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.plan_id<>old.plan_id or new.profile_id<>old.profile_id then raise exception 'plan membership identity cannot change'; end if;
  if new.role is distinct from old.role and not exists(select 1 from public.plans p where p.id=old.plan_id and p.owner_id=auth.uid()) and not public.is_admin() then raise exception 'only the plan owner can change roles'; end if;
  return new;
end;
$$;
drop trigger if exists plan_members_protect_identity on public.plan_members;
create trigger plan_members_protect_identity before update on public.plan_members for each row execute function public.protect_plan_member_identity();

create table public.plan_availability (
  id uuid primary key default gen_random_uuid(),plan_id uuid not null references public.plans(id) on delete cascade,profile_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,ends_at timestamptz not null,note text check (char_length(note)<=300),created_at timestamptz not null default now(),constraint availability_window check (ends_at>starts_at)
);
create index plan_availability_plan_idx on public.plan_availability(plan_id,starts_at,ends_at);

create table public.plan_stops (
  id uuid primary key default gen_random_uuid(),plan_id uuid not null references public.plans(id) on delete cascade,event_id uuid references public.events(id) on delete cascade,location_id uuid references public.locations(id) on delete cascade,
  position numeric(8,3) not null default 1000,planned_for timestamptz,duration_minutes integer check (duration_minutes is null or duration_minutes between 5 and 1440),note text check (char_length(note)<=1000),
  meeting_label text check (char_length(meeting_label)<=300),added_by uuid not null references public.profiles(id) on delete restrict,created_at timestamptz not null default now(),
  constraint plan_stop_one_target check (num_nonnulls(event_id,location_id)=1)
);
create unique index plan_stops_event_unique on public.plan_stops(plan_id,event_id) where event_id is not null;
create unique index plan_stops_location_unique on public.plan_stops(plan_id,location_id) where location_id is not null;
create index plan_stops_order_idx on public.plan_stops(plan_id,position,created_at);

create table public.plan_polls (
  id uuid primary key default gen_random_uuid(),plan_id uuid not null references public.plans(id) on delete cascade,question text not null check (char_length(question) between 2 and 300),
  status text not null default 'open' check (status in ('open','closed','cancelled')),closes_at timestamptz,created_by uuid not null references public.profiles(id) on delete restrict,created_at timestamptz not null default now()
);
create index plan_polls_plan_idx on public.plan_polls(plan_id,status,created_at desc);

create table public.plan_poll_options (
  id uuid primary key default gen_random_uuid(),poll_id uuid not null references public.plan_polls(id) on delete cascade,event_id uuid references public.events(id) on delete cascade,location_id uuid references public.locations(id) on delete cascade,
  label text,sort_order integer not null default 0,created_at timestamptz not null default now(),constraint poll_option_target_or_label check (num_nonnulls(event_id,location_id)+case when nullif(trim(coalesce(label,'')),'') is null then 0 else 1 end=1)
);
create index plan_poll_options_poll_idx on public.plan_poll_options(poll_id,sort_order,created_at);

create table public.plan_votes (
  option_id uuid not null references public.plan_poll_options(id) on delete cascade,profile_id uuid not null references public.profiles(id) on delete cascade,
  choice text not null default 'yes' check (choice in ('yes','maybe','no')),rank integer check (rank is null or rank between 1 and 20),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),primary key(option_id,profile_id)
);

create table public.plan_messages (
  id bigint generated always as identity primary key,plan_id uuid not null references public.plans(id) on delete cascade,sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),created_at timestamptz not null default now(),edited_at timestamptz,deleted_at timestamptz
);
create index plan_messages_plan_idx on public.plan_messages(plan_id,created_at);

create or replace function public.add_plan_stop_v1(target_plan uuid,target_kind text,target_id uuid,planned_time timestamptz default null,stop_note text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();next_position numeric;created uuid;
begin
  if actor is null or not public.can_edit_plan(target_plan) then raise exception 'not authorized'; end if;
  if target_kind not in ('event','place') then raise exception 'invalid stop kind'; end if;
  if target_kind='event' and not exists(select 1 from public.events where id=target_id and status='published') then raise exception 'event unavailable'; end if;
  if target_kind='place' and not exists(select 1 from public.locations where id=target_id and status='published') then raise exception 'place unavailable'; end if;
  select coalesce(max(position),0)+1000 into next_position from public.plan_stops where plan_id=target_plan;
  insert into public.plan_stops(plan_id,event_id,location_id,position,planned_for,note,added_by)
  values(target_plan,case when target_kind='event' then target_id end,case when target_kind='place' then target_id end,next_position,planned_time,left(stop_note,1000),actor) returning id into created;
  return created;
end;
$$;

alter table public.event_checkins enable row level security;
alter table public.location_visits enable row level security;
alter table public.plans enable row level security;
alter table public.plan_members enable row level security;
alter table public.plan_availability enable row level security;
alter table public.plan_stops enable row level security;
alter table public.plan_polls enable row level security;
alter table public.plan_poll_options enable row level security;
alter table public.plan_votes enable row level security;
alter table public.plan_messages enable row level security;

drop policy if exists "own rsvps" on public.event_rsvps;
create policy "attendees read own rsvp" on public.event_rsvps for select using (profile_id=auth.uid());
create policy "event managers read attendee records" on public.event_rsvps for select using (public.can_manage_event(event_id) or public.can_checkin_event(event_id) or public.is_admin());
create policy "checkins visible to attendee and managers" on public.event_checkins for select using (profile_id=auth.uid() or public.can_checkin_event(event_id) or public.is_admin());
create policy "users manage own location visits" on public.location_visits for all using (profile_id=auth.uid()) with check (profile_id=auth.uid());

create policy "plans visible to participants" on public.plans for select using (
  owner_id=auth.uid() or exists(select 1 from public.plan_members pm where pm.plan_id=id and pm.profile_id=auth.uid() and pm.status in ('invited','accepted')) or public.is_admin()
);
create policy "users create plans" on public.plans for insert with check (owner_id=auth.uid());
create policy "plan editors update plans" on public.plans for update using (public.can_edit_plan(id)) with check (public.can_edit_plan(id));
create policy "plan owners delete plans" on public.plans for delete using (owner_id=auth.uid() or public.is_admin());

create policy "plan members visible" on public.plan_members for select using (profile_id=auth.uid() or public.is_plan_member(plan_id) or public.can_edit_plan(plan_id) or public.is_admin());
create policy "plan editors invite friends" on public.plan_members for insert with check (
  public.can_edit_plan(plan_id) and role='member' and status='invited' and invited_by=auth.uid()
  and exists(select 1 from public.friendships f where f.state='accepted' and ((f.requester_id=auth.uid() and f.addressee_id=profile_id) or (f.addressee_id=auth.uid() and f.requester_id=profile_id)))
);
create policy "plan editors manage invitations" on public.plan_members for update using (public.can_edit_plan(plan_id)) with check (public.can_edit_plan(plan_id));
create policy "plan editors remove nonowners" on public.plan_members for delete using (role<>'owner' and public.can_edit_plan(plan_id));

create policy "plan members view availability" on public.plan_availability for select using (public.is_plan_member(plan_id) or public.is_admin());
create policy "members add own availability" on public.plan_availability for insert with check (profile_id=auth.uid() and public.is_plan_member(plan_id));
create policy "members update own availability" on public.plan_availability for update using (profile_id=auth.uid()) with check (profile_id=auth.uid() and public.is_plan_member(plan_id));
create policy "members delete availability" on public.plan_availability for delete using (profile_id=auth.uid() or public.can_edit_plan(plan_id));

create policy "plan members view stops" on public.plan_stops for select using (public.is_plan_member(plan_id) or public.is_admin());
create policy "plan editors add stops" on public.plan_stops for insert with check (added_by=auth.uid() and public.can_edit_plan(plan_id));
create policy "plan editors update stops" on public.plan_stops for update using (public.can_edit_plan(plan_id)) with check (public.can_edit_plan(plan_id));
create policy "plan editors remove stops" on public.plan_stops for delete using (public.can_edit_plan(plan_id));

create policy "plan members view polls" on public.plan_polls for select using (public.is_plan_member(plan_id) or public.is_admin());
create policy "plan editors create polls" on public.plan_polls for insert with check (created_by=auth.uid() and public.can_edit_plan(plan_id));
create policy "plan editors update polls" on public.plan_polls for update using (public.can_edit_plan(plan_id)) with check (public.can_edit_plan(plan_id));
create policy "plan members view poll options" on public.plan_poll_options for select using (exists(select 1 from public.plan_polls p where p.id=poll_id and public.is_plan_member(p.plan_id)) or public.is_admin());
create policy "plan editors create poll options" on public.plan_poll_options for insert with check (exists(select 1 from public.plan_polls p where p.id=poll_id and public.can_edit_plan(p.plan_id)));
create policy "plan editors update poll options" on public.plan_poll_options for update using (exists(select 1 from public.plan_polls p where p.id=poll_id and public.can_edit_plan(p.plan_id))) with check (exists(select 1 from public.plan_polls p where p.id=poll_id and public.can_edit_plan(p.plan_id)));

create policy "plan members view votes" on public.plan_votes for select using (exists(select 1 from public.plan_poll_options o join public.plan_polls p on p.id=o.poll_id where o.id=option_id and public.is_plan_member(p.plan_id)) or public.is_admin());
create policy "members cast own votes" on public.plan_votes for insert with check (profile_id=auth.uid() and exists(select 1 from public.plan_poll_options o join public.plan_polls p on p.id=o.poll_id where o.id=option_id and public.is_plan_member(p.plan_id)));
create policy "members change own votes" on public.plan_votes for update using (profile_id=auth.uid()) with check (profile_id=auth.uid() and exists(select 1 from public.plan_poll_options o join public.plan_polls p on p.id=o.poll_id where o.id=option_id and public.is_plan_member(p.plan_id)));
create policy "members remove own votes" on public.plan_votes for delete using (profile_id=auth.uid());

create policy "plan members read messages" on public.plan_messages for select using (public.is_plan_member(plan_id) or public.is_admin());
create policy "plan members send messages" on public.plan_messages for insert with check (sender_id=auth.uid() and public.is_plan_member(plan_id));
create policy "senders edit own messages" on public.plan_messages for update using (sender_id=auth.uid()) with check (sender_id=auth.uid() and public.is_plan_member(plan_id));

revoke insert,update,delete on public.event_rsvps from authenticated;
revoke all on public.event_checkins from authenticated;
revoke all on function public.sync_plan_meeting_point() from public,anon,authenticated;
revoke all on function public.add_plan_owner() from public,anon,authenticated;
revoke all on function public.next_waitlist_position(uuid) from public,anon,authenticated;
revoke all on function public.promote_event_waitlist_v1(uuid) from public,anon,authenticated;
revoke all on function public.protect_plan_member_identity() from public,anon,authenticated;
revoke all on function public.request_event_attendance_v1(uuid,jsonb,text,integer) from public,anon;
revoke all on function public.promote_event_waitlist_as_manager_v1(uuid) from public,anon;
revoke all on function public.cancel_event_attendance_v1(uuid) from public,anon;
revoke all on function public.approve_event_attendance_v1(uuid,uuid,boolean) from public,anon;
revoke all on function public.check_in_attendee_v1(uuid,uuid,text) from public,anon;
revoke all on function public.respond_plan_invitation_v1(uuid,text) from public,anon;
revoke all on function public.add_plan_stop_v1(uuid,text,uuid,timestamptz,text) from public,anon;

grant select on public.event_rsvps,public.event_checkins to authenticated;
grant select,insert,update,delete on public.location_visits,public.plans,public.plan_members,public.plan_availability,public.plan_stops,public.plan_polls,public.plan_poll_options,public.plan_votes,public.plan_messages to authenticated;
grant usage,select on sequence public.event_checkins_id_seq,public.plan_messages_id_seq to authenticated;
grant execute on function public.can_checkin_event(uuid),public.event_used_capacity(uuid),public.is_plan_member(uuid),public.can_edit_plan(uuid) to authenticated;
grant execute on function public.request_event_attendance_v1(uuid,jsonb,text,integer),public.promote_event_waitlist_as_manager_v1(uuid),public.cancel_event_attendance_v1(uuid),public.approve_event_attendance_v1(uuid,uuid,boolean),public.check_in_attendee_v1(uuid,uuid,text),public.respond_plan_invitation_v1(uuid,text),public.add_plan_stop_v1(uuid,text,uuid,timestamptz,text) to authenticated;
