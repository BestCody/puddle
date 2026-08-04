-- Paid membership, opt-in global same-place discovery, and message requests.
-- The public product name is "Tinder tier" for now; identifiers remain Puddle-owned.

create table if not exists public.puddle_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free','tinder')),
  status text not null default 'inactive' check (status in ('inactive','trialing','active','past_due','canceled','unpaid','incomplete','incomplete_expired','paused')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists puddle_memberships_entitlement_idx
  on public.puddle_memberships(tier,status,current_period_end);
alter table public.puddle_memberships enable row level security;
revoke all on table public.puddle_memberships from public,anon,authenticated;
grant select on table public.puddle_memberships to authenticated;
grant select,insert,update,delete on table public.puddle_memberships to service_role;
drop policy if exists "members read own membership" on public.puddle_memberships;
create policy "members read own membership" on public.puddle_memberships
  for select to authenticated using (user_id=auth.uid());

create table if not exists public.stripe_membership_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_membership_events enable row level security;
revoke all on table public.stripe_membership_events from public,anon,authenticated;
grant select,insert,delete on table public.stripe_membership_events to service_role;

create table if not exists public.global_connection_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  discoverable boolean not null default false,
  intent text not null default 'either' check (intent in ('date','hangout','either')),
  updated_at timestamptz not null default now()
);
alter table public.global_connection_preferences enable row level security;
revoke all on table public.global_connection_preferences from public,anon;
grant select,insert,update on table public.global_connection_preferences to authenticated;
grant select,insert,update,delete on table public.global_connection_preferences to service_role;
drop policy if exists "members manage global preference" on public.global_connection_preferences;
create policy "members manage global preference" on public.global_connection_preferences
  for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

create table if not exists public.global_connection_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(blocker_id,blocked_id),
  check (blocker_id<>blocked_id)
);
alter table public.global_connection_blocks enable row level security;
revoke all on table public.global_connection_blocks from public,anon,authenticated;
grant select,insert,delete on table public.global_connection_blocks to service_role;
drop policy if exists "members read own global blocks" on public.global_connection_blocks;
create policy "members read own global blocks" on public.global_connection_blocks
  for select to authenticated using (blocker_id=auth.uid());

create table if not exists public.global_connection_threads (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  intent text not null default 'either' check (intent in ('date','hangout','either')),
  status text not null default 'pending' check (status in ('pending','accepted','declined','blocked')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  updated_at timestamptz not null default now(),
  check (requester_id<>recipient_id)
);
create unique index if not exists global_connection_threads_pair_location_idx
  on public.global_connection_threads(
    location_id,
    least(requester_id,recipient_id),
    greatest(requester_id,recipient_id)
  );
create index if not exists global_connection_threads_requester_idx
  on public.global_connection_threads(requester_id,updated_at desc);
create index if not exists global_connection_threads_recipient_idx
  on public.global_connection_threads(recipient_id,updated_at desc);
alter table public.global_connection_threads enable row level security;
revoke all on table public.global_connection_threads from public,anon,authenticated;
grant select,insert,update,delete on table public.global_connection_threads to service_role;
drop policy if exists "thread members read global threads" on public.global_connection_threads;
create policy "thread members read global threads" on public.global_connection_threads
  for select to authenticated using (auth.uid() in (requester_id,recipient_id));

create table if not exists public.global_connection_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.global_connection_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists global_connection_messages_thread_idx
  on public.global_connection_messages(thread_id,created_at,id);
alter table public.global_connection_messages enable row level security;
revoke all on table public.global_connection_messages from public,anon,authenticated;
grant select,insert,delete on table public.global_connection_messages to service_role;
drop policy if exists "thread members read global messages" on public.global_connection_messages;
create policy "thread members read global messages" on public.global_connection_messages
  for select to authenticated using (
    exists(
      select 1 from public.global_connection_threads thread
      where thread.id=thread_id and auth.uid() in (thread.requester_id,thread.recipient_id)
    )
  );

create table if not exists public.global_connection_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_id uuid not null references public.profiles(id) on delete cascade,
  thread_id uuid references public.global_connection_threads(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  reason text not null check (reason in ('spam','harassment','unsafe','impersonation','other')),
  details text check (details is null or char_length(details)<=1000),
  created_at timestamptz not null default now(),
  check (reporter_id<>reported_id)
);
create index if not exists global_connection_reports_created_idx
  on public.global_connection_reports(created_at desc);
alter table public.global_connection_reports enable row level security;
revoke all on table public.global_connection_reports from public,anon,authenticated;
grant select,insert,update,delete on table public.global_connection_reports to service_role;
drop policy if exists "members read own global reports" on public.global_connection_reports;
create policy "members read own global reports" on public.global_connection_reports
  for select to authenticated using (reporter_id=auth.uid());

create or replace function public.puddle_tinder_active_v1(target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1 from public.puddle_memberships membership
    where membership.user_id=target_user
      and membership.tier='tinder'
      and membership.status in ('trialing','active')
      and (membership.current_period_end is null or membership.current_period_end>now())
  )
$$;
revoke all on function public.puddle_tinder_active_v1(uuid) from public,anon;
grant execute on function public.puddle_tinder_active_v1(uuid) to authenticated,service_role;

create or replace function public.puddle_adult_v1(target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1 from public.profiles profile
    where profile.id=target_user
      and profile.birth_date is not null
      and profile.birth_date<=current_date-interval '18 years'
  )
$$;
revoke all on function public.puddle_adult_v1(uuid) from public,anon;
grant execute on function public.puddle_adult_v1(uuid) to authenticated,service_role;

create or replace function public.global_like_matches_v1(max_rows integer default 48)
returns table(
  user_id uuid,
  display_name text,
  username text,
  bio text,
  avatar_path text,
  user_city text,
  user_country text,
  intent text,
  location_id uuid,
  location_name text,
  location_city text,
  cover_path text,
  shared_at timestamptz
)
language plpgsql
stable
security definer
set search_path=public
as $$
declare actor uuid:=auth.uid();
begin
  if actor is null then raise exception 'authentication required'; end if;
  if not public.puddle_tinder_active_v1(actor) then raise exception 'Tinder tier required'; end if;
  if not public.puddle_adult_v1(actor) then raise exception 'global connections require age 18 or older'; end if;
  if not exists(
    select 1 from public.global_connection_preferences preference
    where preference.user_id=actor and preference.discoverable
  ) then return; end if;

  return query
  with my_likes as (
    select action.location_id,max(action.created_at) liked_at
    from public.discovery_actions action
    where action.profile_id=actor
      and action.action in ('saved','interested')
      and action.undone_at is null
    group by action.location_id
  ), their_likes as (
    select action.profile_id,action.location_id,max(action.created_at) liked_at
    from public.discovery_actions action
    where action.profile_id<>actor
      and action.action in ('saved','interested')
      and action.undone_at is null
    group by action.profile_id,action.location_id
  )
  select profile.id,profile.display_name,profile.username,profile.bio,profile.avatar_path,
    profile.city,profile.country,preference.intent,
    location.id,location.name,location.city,location.cover_path,
    greatest(mine.liked_at,theirs.liked_at)
  from my_likes mine
  join their_likes theirs on theirs.location_id=mine.location_id
  join public.profiles profile on profile.id=theirs.profile_id
  join public.global_connection_preferences preference
    on preference.user_id=profile.id and preference.discoverable
  join public.locations location on location.id=mine.location_id
  where public.puddle_tinder_active_v1(profile.id)
    and public.puddle_adult_v1(profile.id)
    and coalesce(profile.profile_visibility,'public')<>'hidden'
    and not exists(
      select 1 from public.global_connection_blocks block
      where (block.blocker_id=actor and block.blocked_id=profile.id)
         or (block.blocker_id=profile.id and block.blocked_id=actor)
    )
  order by greatest(mine.liked_at,theirs.liked_at) desc,profile.display_name
  limit least(96,greatest(1,coalesce(max_rows,48)));
end;
$$;
revoke all on function public.global_like_matches_v1(integer) from public,anon;
grant execute on function public.global_like_matches_v1(integer) to authenticated;

create or replace function public.request_global_connection_v1(
  target_user uuid,
  target_location uuid,
  opening_message text,
  requested_intent text default 'either'
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid:=auth.uid();
  body_value text:=regexp_replace(trim(coalesce(opening_message,'')),'\s+',' ','g');
  intent_value text:=case when requested_intent in ('date','hangout','either') then requested_intent else 'either' end;
  thread_id uuid;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if target_user is null or target_user=actor then raise exception 'invalid recipient'; end if;
  if char_length(body_value) not between 1 and 800 then raise exception 'message must be between 1 and 800 characters'; end if;
  if not public.puddle_tinder_active_v1(actor) or not public.puddle_adult_v1(actor) then raise exception 'Tinder tier and age 18 or older are required'; end if;
  if not public.puddle_tinder_active_v1(target_user) or not public.puddle_adult_v1(target_user) then raise exception 'recipient is unavailable'; end if;
  if not exists(select 1 from public.global_connection_preferences where user_id=actor and discoverable) then raise exception 'turn on global visibility first'; end if;
  if not exists(select 1 from public.global_connection_preferences where user_id=target_user and discoverable) then raise exception 'recipient is unavailable'; end if;
  if exists(
    select 1 from public.global_connection_blocks block
    where (block.blocker_id=actor and block.blocked_id=target_user)
       or (block.blocker_id=target_user and block.blocked_id=actor)
  ) then raise exception 'recipient is unavailable'; end if;
  if not exists(
    select 1 from public.discovery_actions action
    where action.profile_id=actor and action.location_id=target_location
      and action.action in ('saved','interested') and action.undone_at is null
  ) or not exists(
    select 1 from public.discovery_actions action
    where action.profile_id=target_user and action.location_id=target_location
      and action.action in ('saved','interested') and action.undone_at is null
  ) then raise exception 'shared place is unavailable'; end if;

  select thread.id into thread_id
  from public.global_connection_threads thread
  where thread.location_id=target_location
    and least(thread.requester_id,thread.recipient_id)=least(actor,target_user)
    and greatest(thread.requester_id,thread.recipient_id)=greatest(actor,target_user)
  for update;
  if thread_id is not null then raise exception 'a request already exists for this person and place'; end if;

  insert into public.global_connection_threads(location_id,requester_id,recipient_id,intent)
  values(target_location,actor,target_user,intent_value)
  returning id into thread_id;
  insert into public.global_connection_messages(thread_id,sender_id,body)
  values(thread_id,actor,body_value);
  return thread_id;
end;
$$;
revoke all on function public.request_global_connection_v1(uuid,uuid,text,text) from public,anon;
grant execute on function public.request_global_connection_v1(uuid,uuid,text,text) to authenticated;

create or replace function public.respond_global_connection_v1(target_thread uuid,decision text)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare actor uuid:=auth.uid(); changed integer;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if decision not in ('accepted','declined') then raise exception 'invalid decision'; end if;
  update public.global_connection_threads
  set status=decision,responded_at=now(),updated_at=now()
  where id=target_thread and recipient_id=actor and status='pending';
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'request is unavailable'; end if;
  return true;
end;
$$;
revoke all on function public.respond_global_connection_v1(uuid,text) from public,anon;
grant execute on function public.respond_global_connection_v1(uuid,text) to authenticated;

create or replace function public.send_global_connection_message_v1(target_thread uuid,message_body text)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid:=auth.uid();
  body_value text:=regexp_replace(trim(coalesce(message_body,'')),'\s+',' ','g');
  message_id bigint;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if char_length(body_value) not between 1 and 1000 then raise exception 'message must be between 1 and 1000 characters'; end if;
  if not public.puddle_tinder_active_v1(actor) or not public.puddle_adult_v1(actor) then raise exception 'Tinder tier and age 18 or older are required'; end if;
  if not exists(
    select 1 from public.global_connection_threads thread
    where thread.id=target_thread and thread.status='accepted'
      and actor in (thread.requester_id,thread.recipient_id)
  ) then raise exception 'conversation is unavailable'; end if;
  insert into public.global_connection_messages(thread_id,sender_id,body)
  values(target_thread,actor,body_value) returning id into message_id;
  update public.global_connection_threads set updated_at=now() where id=target_thread;
  return message_id;
end;
$$;
revoke all on function public.send_global_connection_message_v1(uuid,text) from public,anon;
grant execute on function public.send_global_connection_message_v1(uuid,text) to authenticated;

create or replace function public.global_connection_snapshot_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare actor uuid:=auth.uid(); result jsonb;
begin
  if actor is null then raise exception 'authentication required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',thread.id,
    'status',thread.status,
    'intent',thread.intent,
    'incoming',thread.recipient_id=actor,
    'createdAt',thread.created_at,
    'updatedAt',thread.updated_at,
    'person',jsonb_build_object(
      'id',other.id,'displayName',other.display_name,'username',other.username,
      'avatarPath',other.avatar_path,'city',other.city,'country',other.country
    ),
    'place',jsonb_build_object(
      'id',location.id,'name',location.name,'city',location.city,'coverPath',location.cover_path
    ),
    'messages',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',message.id,'senderId',message.sender_id,'body',message.body,'createdAt',message.created_at
      ) order by message.created_at,message.id)
      from (
        select item.* from public.global_connection_messages item
        where item.thread_id=thread.id order by item.created_at desc,item.id desc limit 100
      ) message
    ),'[]'::jsonb)
  ) order by thread.updated_at desc),'[]'::jsonb)
  into result
  from public.global_connection_threads thread
  join public.profiles other on other.id=case when thread.requester_id=actor then thread.recipient_id else thread.requester_id end
  join public.locations location on location.id=thread.location_id
  where actor in (thread.requester_id,thread.recipient_id);
  return jsonb_build_object(
    'eligible',public.puddle_tinder_active_v1(actor) and public.puddle_adult_v1(actor),
    'threads',coalesce(result,'[]'::jsonb)
  );
end;
$$;
revoke all on function public.global_connection_snapshot_v1() from public,anon;
grant execute on function public.global_connection_snapshot_v1() to authenticated;

create or replace function public.block_global_connection_v1(target_user uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare actor uuid:=auth.uid();
begin
  if actor is null then raise exception 'authentication required'; end if;
  if target_user is null or target_user=actor then raise exception 'invalid account'; end if;
  insert into public.global_connection_blocks(blocker_id,blocked_id)
  values(actor,target_user) on conflict do nothing;
  update public.global_connection_threads set status='blocked',updated_at=now()
  where actor in (requester_id,recipient_id) and target_user in (requester_id,recipient_id);
  return true;
end;
$$;
revoke all on function public.block_global_connection_v1(uuid) from public,anon;
grant execute on function public.block_global_connection_v1(uuid) to authenticated;

create or replace function public.report_global_connection_v1(
  target_user uuid,
  target_thread uuid,
  report_reason text,
  report_details text default null
)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare actor uuid:=auth.uid(); report_id bigint; details_value text:=nullif(trim(coalesce(report_details,'')),'');
begin
  if actor is null then raise exception 'authentication required'; end if;
  if target_user is null or target_user=actor then raise exception 'invalid account'; end if;
  if report_reason not in ('spam','harassment','unsafe','impersonation','other') then raise exception 'invalid reason'; end if;
  if details_value is not null and char_length(details_value)>1000 then raise exception 'report details are too long'; end if;
  if target_thread is not null and not exists(
    select 1 from public.global_connection_threads thread
    where thread.id=target_thread and actor in (thread.requester_id,thread.recipient_id)
      and target_user in (thread.requester_id,thread.recipient_id)
  ) then raise exception 'conversation is unavailable'; end if;
  insert into public.global_connection_reports(reporter_id,reported_id,thread_id,location_id,reason,details)
  select actor,target_user,target_thread,thread.location_id,report_reason,details_value
  from (select target_thread id) requested
  left join public.global_connection_threads thread on thread.id=requested.id
  returning id into report_id;
  return report_id;
end;
$$;
revoke all on function public.report_global_connection_v1(uuid,uuid,text,text) from public,anon;
grant execute on function public.report_global_connection_v1(uuid,uuid,text,text) to authenticated;
