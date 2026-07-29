-- Stage 2: event and location editors, revisions, claims, recurrence, and controlled publication.
-- Apply after 0003_unified_product_foundation.sql and 0004_remove_person_matching_legacy.sql.

alter table public.host_profiles add column if not exists contact_links jsonb not null default '{}'::jsonb;

alter table public.events add column if not exists event_format text not null default 'in_person';
alter table public.events add column if not exists address_public text;
alter table public.events add column if not exists private_address text;
alter table public.events add column if not exists online_url text;
alter table public.events add column if not exists visibility text not null default 'public';
alter table public.events add column if not exists tags text[] not null default '{}';
alter table public.events add column if not exists accessibility jsonb not null default '{}'::jsonb;
alter table public.events add column if not exists attendee_questions jsonb not null default '[]'::jsonb;
alter table public.events add column if not exists contact_links jsonb not null default '{}'::jsonb;
alter table public.events add column if not exists recurrence_rule text;
alter table public.events add column if not exists recurrence_ends_at timestamptz;
alter table public.events add column if not exists publish_at timestamptz;
alter table public.events add column if not exists approval_required boolean not null default false;
alter table public.events add column if not exists comments_enabled boolean not null default true;
alter table public.events add column if not exists chat_enabled boolean not null default true;
alter table public.events add column if not exists autosaved_at timestamptz;
alter table public.events add column if not exists submitted_at timestamptz;
alter table public.events add column if not exists postponed_at timestamptz;
alter table public.events add column if not exists cancelled_at timestamptz;
alter table public.events add column if not exists completed_at timestamptz;
alter table public.events add column if not exists archived_at timestamptz;
alter table public.events add column if not exists status_reason text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='events_format_check') then
    alter table public.events add constraint events_format_check check (event_format in ('in_person','online','hybrid','private'));
  end if;
  if not exists (select 1 from pg_constraint where conname='events_visibility_check') then
    alter table public.events add constraint events_visibility_check check (visibility in ('public','unlisted','private'));
  end if;
  if not exists (select 1 from pg_constraint where conname='events_recurrence_window_check') then
    alter table public.events add constraint events_recurrence_window_check check (recurrence_ends_at is null or recurrence_ends_at >= starts_at);
  end if;
end $$;

alter table public.locations add column if not exists private_address text;
alter table public.locations add column if not exists visibility text not null default 'public';
alter table public.locations add column if not exists tags text[] not null default '{}';
alter table public.locations add column if not exists contact_links jsonb not null default '{}'::jsonb;
alter table public.locations add column if not exists comments_enabled boolean not null default true;
alter table public.locations add column if not exists autosaved_at timestamptz;
alter table public.locations add column if not exists submitted_at timestamptz;
alter table public.locations add column if not exists published_at timestamptz;
alter table public.locations add column if not exists archived_at timestamptz;
alter table public.locations add column if not exists status_reason text;
alter table public.locations add column if not exists claimed_by_host_id uuid references public.host_profiles(id) on delete set null;
alter table public.locations add column if not exists claimed_at timestamptz;
alter table public.locations drop constraint if exists locations_status_check;
alter table public.locations add constraint locations_status_check check (status in ('draft','pending_review','scheduled','published','postponed','cancelled','rejected','suspended','completed','archived'));

do $$ begin
  if not exists (select 1 from pg_constraint where conname='locations_visibility_check') then
    alter table public.locations add constraint locations_visibility_check check (visibility in ('public','unlisted','private'));
  end if;
end $$;

create table if not exists public.event_occurrences (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  sequence_no integer not null check (sequence_no >= 1),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','published','postponed','cancelled','completed')),
  capacity_override integer check (capacity_override is null or capacity_override > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_occurrence_time_check check (ends_at > starts_at),
  unique(event_id,sequence_no)
);
create index if not exists event_occurrences_event_time_idx on public.event_occurrences(event_id,starts_at);
create index if not exists event_occurrences_public_time_idx on public.event_occurrences(status,starts_at);

create table if not exists public.event_revisions (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  revision_no integer not null,
  actor_id uuid references public.profiles(id) on delete set null,
  change_source text not null default 'update' check (change_source in ('create','autosave','manual','publication','status','system','update')),
  note text check (char_length(note) <= 1000),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique(event_id,revision_no)
);
create index if not exists event_revisions_event_idx on public.event_revisions(event_id,revision_no desc);

create table if not exists public.location_revisions (
  id bigint generated always as identity primary key,
  location_id uuid not null references public.locations(id) on delete cascade,
  revision_no integer not null,
  actor_id uuid references public.profiles(id) on delete set null,
  change_source text not null default 'update' check (change_source in ('create','autosave','manual','publication','status','claim','system','update')),
  note text check (char_length(note) <= 1000),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique(location_id,revision_no)
);
create index if not exists location_revisions_location_idx on public.location_revisions(location_id,revision_no desc);

create table if not exists public.location_claims (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  claimant_id uuid not null references public.profiles(id) on delete cascade,
  host_profile_id uuid references public.host_profiles(id) on delete cascade,
  relationship text not null check (char_length(relationship) between 2 and 120),
  evidence_url text,
  note text check (char_length(note) <= 1200),
  status text not null default 'pending' check (status in ('pending','under_review','approved','rejected','withdrawn')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists location_claims_open_unique on public.location_claims(location_id,claimant_id) where status in ('pending','under_review');
create index if not exists location_claims_queue_idx on public.location_claims(status,created_at);

create or replace function public.can_manage_location(target uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.locations l where l.id=target and (
      l.created_by=auth.uid()
      or (l.host_profile_id is not null and public.has_host_role(l.host_profile_id,array['owner','editor']))
      or (l.claimed_by_host_id is not null and public.has_host_role(l.claimed_by_host_id,array['owner','editor']))
      or public.is_admin()
    )
  )
$$;

create or replace function public.capture_event_revision()
returns trigger language plpgsql security definer set search_path=public as $$
declare next_revision integer;
begin
  perform pg_advisory_xact_lock(hashtext(new.id::text));
  select coalesce(max(revision_no),0)+1 into next_revision from public.event_revisions where event_id=new.id;
  insert into public.event_revisions(event_id,revision_no,actor_id,change_source,note,snapshot)
  values(new.id,next_revision,auth.uid(),case when tg_op='INSERT' then 'create' else coalesce(nullif(current_setting('puddle.change_source',true),''),'update') end,nullif(current_setting('puddle.change_note',true),''),to_jsonb(new));
  return new;
end;
$$;
drop trigger if exists events_capture_revision on public.events;
create trigger events_capture_revision after insert or update on public.events for each row execute function public.capture_event_revision();

create or replace function public.capture_location_revision()
returns trigger language plpgsql security definer set search_path=public as $$
declare next_revision integer;
begin
  perform pg_advisory_xact_lock(hashtext(new.id::text));
  select coalesce(max(revision_no),0)+1 into next_revision from public.location_revisions where location_id=new.id;
  insert into public.location_revisions(location_id,revision_no,actor_id,change_source,note,snapshot)
  values(new.id,next_revision,auth.uid(),case when tg_op='INSERT' then 'create' else coalesce(nullif(current_setting('puddle.change_source',true),''),'update') end,nullif(current_setting('puddle.change_note',true),''),to_jsonb(new));
  return new;
end;
$$;
drop trigger if exists locations_capture_revision on public.locations;
create trigger locations_capture_revision after insert or update on public.locations for each row execute function public.capture_location_revision();

create or replace function public.guard_event_publication_fields()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='UPDATE' and new.slug is distinct from old.slug and not public.is_admin() then raise exception 'Event slugs are stable after creation'; end if;
  if tg_op='UPDATE' and new.status is distinct from old.status and coalesce(current_setting('puddle.allow_status_transition',true),'')<>'on' then raise exception 'Use the controlled event publication workflow'; end if;
  if new.status<>'draft' and new.event_format in ('online','hybrid') and nullif(trim(coalesce(new.online_url,'')),'') is null then raise exception 'Online and hybrid events require an online URL'; end if;
  if new.status<>'draft' and new.event_format in ('in_person','hybrid','private') and new.location_id is null and nullif(trim(coalesce(new.address_public,'')),'') is null and nullif(trim(coalesce(new.private_address,'')),'') is null then raise exception 'In-person events require a location or address'; end if;
  return new;
end;
$$;
drop trigger if exists events_guard_publication_fields on public.events;
create trigger events_guard_publication_fields before insert or update on public.events for each row execute function public.guard_event_publication_fields();

create or replace function public.guard_location_publication_fields()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='UPDATE' and new.slug is distinct from old.slug and not public.is_admin() then raise exception 'Location slugs are stable after creation'; end if;
  if tg_op='UPDATE' and new.status is distinct from old.status and coalesce(current_setting('puddle.allow_status_transition',true),'')<>'on' then raise exception 'Use the controlled location publication workflow'; end if;
  return new;
end;
$$;
drop trigger if exists locations_guard_publication_fields on public.locations;
create trigger locations_guard_publication_fields before update on public.locations for each row execute function public.guard_location_publication_fields();

create or replace function public.sync_event_occurrences()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  interval_step interval;
  occurrence_start timestamptz;
  occurrence_end timestamptz;
  occurrence_number integer := 1;
  max_end timestamptz;
begin
  delete from public.event_occurrences where event_id=new.id;
  insert into public.event_occurrences(event_id,sequence_no,starts_at,ends_at,status)
  values(new.id,1,new.starts_at,new.ends_at,case when new.status in ('cancelled','postponed','completed') then new.status::text when new.status='published' then 'published' else 'scheduled' end);
  if new.recurrence_rule is null or new.recurrence_rule='' then return new; end if;
  interval_step := case new.recurrence_rule when 'FREQ=DAILY' then interval '1 day' when 'FREQ=WEEKLY' then interval '1 week' when 'FREQ=MONTHLY' then interval '1 month' else null end;
  if interval_step is null then return new; end if;
  max_end := least(coalesce(new.recurrence_ends_at,new.starts_at + interval '1 year'),new.starts_at + interval '1 year');
  occurrence_start := new.starts_at + interval_step;
  occurrence_end := new.ends_at + interval_step;
  while occurrence_start <= max_end and occurrence_number < 52 loop
    occurrence_number := occurrence_number + 1;
    insert into public.event_occurrences(event_id,sequence_no,starts_at,ends_at,status) values(new.id,occurrence_number,occurrence_start,occurrence_end,'scheduled');
    occurrence_start := occurrence_start + interval_step;
    occurrence_end := occurrence_end + interval_step;
  end loop;
  return new;
end;
$$;
drop trigger if exists events_sync_occurrences on public.events;
create trigger events_sync_occurrences after insert or update of starts_at,ends_at,recurrence_rule,recurrence_ends_at,status on public.events for each row execute function public.sync_event_occurrences();

create or replace function public.request_event_publication(target uuid)
returns text language plpgsql security definer set search_path=public as $$
declare record_event public.events%rowtype; next_state public.event_status;
begin
  if not public.can_manage_event(target) then raise exception 'Not authorized to publish this event'; end if;
  select * into record_event from public.events where id=target for update;
  if record_event.status not in ('draft','rejected','postponed') then raise exception 'This event cannot enter publication from its current status'; end if;
  if record_event.title is null or char_length(record_event.title)<3 or record_event.ends_at<=record_event.starts_at then raise exception 'Complete the required event details'; end if;
  if record_event.event_format in ('online','hybrid') and record_event.online_url is null then raise exception 'Add the online event link'; end if;
  if record_event.event_format in ('in_person','hybrid','private') and record_event.location_id is null and record_event.address_public is null and record_event.private_address is null then raise exception 'Add the event location'; end if;
  next_state := case when record_event.publish_at is not null and record_event.publish_at>now() then 'scheduled'::public.event_status when record_event.event_format='private' or coalesce(record_event.min_age,0)>=18 or coalesce(record_event.capacity,0)>1000 then 'pending_review'::public.event_status else 'published'::public.event_status end;
  perform set_config('puddle.allow_status_transition','on',true);
  perform set_config('puddle.change_source','publication',true);
  update public.events set status=next_state,submitted_at=now(),published_at=case when next_state='published' then now() else published_at end,status_reason=null where id=target;
  return next_state::text;
end;
$$;

create or replace function public.transition_event_status(target uuid,next_status text,transition_note text default null)
returns text language plpgsql security definer set search_path=public as $$
declare current_state public.event_status; desired public.event_status;
begin
  if not public.can_manage_event(target) then raise exception 'Not authorized to manage this event'; end if;
  desired := next_status::public.event_status;
  select status into current_state from public.events where id=target for update;
  if current_state='suspended' and not public.is_admin() then raise exception 'A moderator must review suspended events'; end if;
  if not (
    (current_state='draft' and desired in ('pending_review','scheduled','published','archived')) or
    (current_state='pending_review' and desired in ('draft','published','rejected','suspended','archived')) or
    (current_state='scheduled' and desired in ('published','postponed','cancelled','archived')) or
    (current_state='published' and desired in ('postponed','cancelled','completed','suspended','archived')) or
    (current_state='postponed' and desired in ('scheduled','published','cancelled','archived')) or
    (current_state='cancelled' and desired='archived') or
    (current_state='rejected' and desired in ('draft','archived')) or
    (current_state='suspended' and desired in ('draft','archived')) or
    (current_state='completed' and desired='archived')
  ) then raise exception 'Invalid event status transition'; end if;
  if desired in ('published','rejected','suspended') and not public.is_admin() then raise exception 'A moderator must review this transition'; end if;
  perform set_config('puddle.allow_status_transition','on',true);
  perform set_config('puddle.change_source','status',true);
  perform set_config('puddle.change_note',coalesce(transition_note,''),true);
  update public.events set status=desired,status_reason=transition_note,published_at=case when desired='published' then coalesce(published_at,now()) else published_at end,postponed_at=case when desired='postponed' then now() else postponed_at end,cancelled_at=case when desired='cancelled' then now() else cancelled_at end,completed_at=case when desired='completed' then now() else completed_at end,archived_at=case when desired='archived' then now() else archived_at end where id=target;
  return desired::text;
end;
$$;

create or replace function public.publish_due_events()
returns integer language plpgsql security definer set search_path=public as $$
declare published_count integer;
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.is_admin() then raise exception 'Service or admin access required'; end if;
  perform set_config('puddle.allow_status_transition','on',true);
  perform set_config('puddle.change_source','publication',true);
  update public.events set status='published',published_at=coalesce(published_at,now()),status_reason=null
  where status='scheduled' and publish_at is not null and publish_at<=now();
  get diagnostics published_count = row_count;
  return published_count;
end;
$$;

create or replace function public.request_location_publication(target uuid)
returns text language plpgsql security definer set search_path=public as $$
declare record_location public.locations%rowtype; next_state text; trusted_host boolean := false;
begin
  if not public.can_manage_location(target) then raise exception 'Not authorized to publish this location'; end if;
  select * into record_location from public.locations where id=target for update;
  if record_location.status not in ('draft','rejected') then raise exception 'This location cannot enter publication from its current status'; end if;
  if record_location.name is null or record_location.city is null or (record_location.address_public is null and record_location.private_address is null) then raise exception 'Complete the required location details'; end if;
  if record_location.host_profile_id is not null then select exists(select 1 from public.host_profiles where id=record_location.host_profile_id and verification_status='verified' and status='active') into trusted_host; end if;
  next_state := case when trusted_host then 'published' else 'pending_review' end;
  perform set_config('puddle.allow_status_transition','on',true);
  perform set_config('puddle.change_source','publication',true);
  update public.locations set status=next_state,submitted_at=now(),published_at=case when next_state='published' then now() else published_at end,status_reason=null where id=target;
  return next_state;
end;
$$;

create or replace function public.transition_location_status(target uuid,next_status text,transition_note text default null)
returns text language plpgsql security definer set search_path=public as $$
declare current_state text; allowed boolean := false;
begin
  if not public.can_manage_location(target) then raise exception 'Not authorized to manage this location'; end if;
  select status into current_state from public.locations where id=target for update;
  if current_state='suspended' and not public.is_admin() then raise exception 'A moderator must review suspended locations'; end if;
  allowed := (current_state='draft' and next_status in ('pending_review','published','archived')) or (current_state='pending_review' and next_status in ('draft','published','rejected','suspended','archived')) or (current_state='published' and next_status in ('suspended','archived')) or (current_state in ('rejected','suspended') and next_status in ('draft','archived'));
  if not allowed then raise exception 'Invalid location status transition'; end if;
  if next_status in ('published','rejected','suspended') and not public.is_admin() then raise exception 'A moderator must review this transition'; end if;
  perform set_config('puddle.allow_status_transition','on',true);
  perform set_config('puddle.change_source','status',true);
  perform set_config('puddle.change_note',coalesce(transition_note,''),true);
  update public.locations set status=next_status,status_reason=transition_note,published_at=case when next_status='published' then coalesce(published_at,now()) else published_at end,archived_at=case when next_status='archived' then now() else archived_at end where id=target;
  return next_status;
end;
$$;

create or replace function public.approve_location_claim(target uuid,decision_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare claim public.location_claims%rowtype;
begin
  if not public.is_admin() then raise exception 'Moderator access required'; end if;
  select * into claim from public.location_claims where id=target for update;
  if claim.status not in ('pending','under_review') then raise exception 'Claim is not reviewable'; end if;
  update public.location_claims set status='approved',reviewed_by=auth.uid(),reviewed_at=now(),review_note=decision_note where id=target;
  if claim.host_profile_id is not null then update public.locations set claimed_by_host_id=claim.host_profile_id,claimed_at=now() where id=claim.location_id; end if;
end;
$$;

alter table public.event_occurrences enable row level security;
alter table public.event_revisions enable row level security;
alter table public.location_revisions enable row level security;
alter table public.location_claims enable row level security;

create policy "published event occurrences read" on public.event_occurrences for select using (exists(select 1 from public.events e where e.id=event_id and (e.status='published' or public.can_manage_event(e.id) or public.is_admin())));
create policy "event managers manage occurrences" on public.event_occurrences for all using (public.can_manage_event(event_id) or public.is_admin()) with check (public.can_manage_event(event_id) or public.is_admin());
create policy "event managers read revisions" on public.event_revisions for select using (public.can_manage_event(event_id) or public.is_admin());
create policy "location managers read revisions" on public.location_revisions for select using (public.can_manage_location(location_id) or public.is_admin());
create policy "claimants submit location claims" on public.location_claims for insert with check (claimant_id=auth.uid() and (host_profile_id is null or public.is_host_member(host_profile_id)));
create policy "claim participants read claims" on public.location_claims for select using (claimant_id=auth.uid() or public.can_manage_location(location_id) or public.is_admin());
create policy "claimants withdraw claims" on public.location_claims for update using (claimant_id=auth.uid() and status in ('pending','under_review')) with check (claimant_id=auth.uid() and status='withdrawn');
create policy "moderators manage location claims" on public.location_claims for all using (public.is_admin()) with check (public.is_admin());

grant select on public.event_occurrences to anon,authenticated;
grant select on public.event_revisions,public.location_revisions to authenticated;
grant select,insert,update on public.location_claims to authenticated;
grant execute on function public.request_event_publication(uuid) to authenticated;
grant execute on function public.transition_event_status(uuid,text,text) to authenticated;
grant execute on function public.request_location_publication(uuid) to authenticated;
revoke execute on function public.publish_due_events() from public,anon,authenticated;
grant execute on function public.transition_location_status(uuid,text,text) to authenticated;
revoke execute on function public.approve_location_claim(uuid,text) from public,anon,authenticated;
