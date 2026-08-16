-- Complete the product capabilities advertised by Puddle Pass.

alter table public.conversations
  add column if not exists pass_initiated_by uuid references public.profiles(id) on delete set null;

create index if not exists conversations_pass_initiated_by_idx
  on public.conversations(pass_initiated_by)
  where pass_initiated_by is not null;

create or replace function public.pass_can_message_profile_v1(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and target is not null
    and target <> auth.uid()
    and public.puddle_tinder_active_v1(auth.uid())
    and public.puddle_adult_v1(target)
    and exists (
      select 1
      from public.profiles profile
      where profile.id = target
        and profile.suspended_at is null
        and coalesce(profile.profile_visibility, 'public') <> 'hidden'
    )
    and not exists (
      select 1
      from public.blocks block
      where (block.blocker_id = auth.uid() and block.blocked_id = target)
         or (block.blocker_id = target and block.blocked_id = auth.uid())
    )
$$;

create or replace function public.pass_message_search_v1(search_term text)
returns table(
  id uuid,
  display_name text,
  username text,
  city text,
  bio text,
  avatar_path text,
  is_friend boolean,
  can_message boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    profile.id,
    profile.display_name,
    profile.username,
    profile.city,
    profile.bio,
    profile.avatar_path,
    public.profiles_are_friends(auth.uid(), profile.id) as is_friend,
    public.pass_can_message_profile_v1(profile.id) as can_message
  from public.profiles profile
  where public.puddle_tinder_active_v1(auth.uid())
    and profile.id <> auth.uid()
    and profile.suspended_at is null
    and coalesce(profile.profile_visibility, 'public') <> 'hidden'
    and public.puddle_adult_v1(profile.id)
    and not exists (
      select 1 from public.blocks block
      where (block.blocker_id = auth.uid() and block.blocked_id = profile.id)
         or (block.blocker_id = profile.id and block.blocked_id = auth.uid())
    )
    and (
      profile.username ilike '%' || trim(leading '@' from coalesce(search_term, '')) || '%'
      or profile.display_name ilike '%' || trim(coalesce(search_term, '')) || '%'
    )
  order by profile.display_name nulls last, profile.username nulls last
  limit 30
$$;

create or replace function public.pass_open_direct_conversation_v1(target uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  cid uuid;
  already_friends boolean;
begin
  if actor is null then raise exception 'Authentication required.'; end if;
  already_friends := public.profiles_are_friends(actor, target);
  if not already_friends and not public.pass_can_message_profile_v1(target) then
    raise exception 'Profile unavailable.';
  end if;

  select conversation.id into cid
  from public.conversations conversation
  where conversation.kind = 'direct'
    and exists (
      select 1 from public.conversation_members member
      where member.conversation_id = conversation.id and member.profile_id = actor and member.left_at is null
    )
    and exists (
      select 1 from public.conversation_members member
      where member.conversation_id = conversation.id and member.profile_id = target and member.left_at is null
    )
  order by conversation.updated_at desc nulls last, conversation.created_at desc
  limit 1;

  if cid is null then
    insert into public.conversations(kind, created_by, pass_initiated_by, updated_at)
    values ('direct', actor, case when already_friends then null else actor end, now())
    returning id into cid;

    insert into public.conversation_members(conversation_id, profile_id, member_role)
    values (cid, actor, 'owner'), (cid, target, 'member');
  elsif not already_friends then
    update public.conversations
      set pass_initiated_by = coalesce(pass_initiated_by, actor), updated_at = now()
      where id = cid;
  end if;

  return cid;
end;
$$;

create or replace function public.social_conversation_peer_v2(target uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select peer.profile_id
  from public.conversations conversation
  join public.conversation_members mine
    on mine.conversation_id = conversation.id
   and mine.profile_id = auth.uid()
   and mine.left_at is null
  join public.conversation_members peer
    on peer.conversation_id = conversation.id
   and peer.profile_id <> auth.uid()
   and peer.left_at is null
  join public.profiles profile
    on profile.id = peer.profile_id
   and profile.suspended_at is null
  where conversation.id = target
    and conversation.kind = 'direct'
    and not exists (
      select 1 from public.blocks block
      where (block.blocker_id = auth.uid() and block.blocked_id = peer.profile_id)
         or (block.blocker_id = peer.profile_id and block.blocked_id = auth.uid())
    )
    and (
      public.profiles_are_friends(auth.uid(), peer.profile_id)
      or conversation.pass_initiated_by is not null
    )
  limit 1
$$;

create or replace function public.social_conversations_v1()
returns table(
  conversation_id uuid,
  friend_id uuid,
  display_name text,
  username text,
  avatar_path text,
  last_message text,
  last_message_type text,
  last_message_at timestamptz,
  unread_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select member.conversation_id, member.last_read_message_id
    from public.conversation_members member
    join public.conversations conversation on conversation.id = member.conversation_id and conversation.kind = 'direct'
    where member.profile_id = auth.uid() and member.left_at is null
  ), peers as (
    select mine.conversation_id, mine.last_read_message_id, member.profile_id friend_id
    from mine
    join public.conversation_members member
      on member.conversation_id = mine.conversation_id
     and member.profile_id <> auth.uid()
     and member.left_at is null
  )
  select
    peers.conversation_id,
    profile.id,
    profile.display_name,
    profile.username,
    profile.avatar_path,
    latest.body,
    latest.message_type,
    latest.created_at,
    (
      select count(*)
      from public.messages unread
      where unread.conversation_id = peers.conversation_id
        and unread.sender_id <> auth.uid()
        and unread.deleted_at is null
        and unread.id > coalesce(peers.last_read_message_id, 0)
    ) unread_count
  from peers
  join public.profiles profile on profile.id = peers.friend_id
  left join lateral (
    select message.body, message.message_type, message.created_at
    from public.messages message
    where message.conversation_id = peers.conversation_id and message.deleted_at is null
    order by message.id desc
    limit 1
  ) latest on true
  where public.social_conversation_peer_v2(peers.conversation_id) = profile.id
  order by latest.created_at desc nulls last, profile.display_name
$$;

create or replace function public.social_messages_v1(target uuid)
returns table(
  id bigint,
  sender_id uuid,
  sender_name text,
  sender_avatar_path text,
  body text,
  message_type text,
  metadata jsonb,
  edited_at timestamptz,
  created_at timestamptz,
  location_id uuid,
  location_name text,
  location_city text,
  location_slug text,
  location_cover_path text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.social_conversation_peer_v2(target) is null then raise exception 'Conversation unavailable.'; end if;
  return query
  select
    message.id,
    message.sender_id,
    coalesce(profile.display_name, profile.username, 'Someone'),
    profile.avatar_path,
    message.body,
    message.message_type,
    message.metadata,
    message.edited_at,
    message.created_at,
    location.id,
    location.name,
    location.city,
    location.slug,
    location.cover_path
  from public.messages message
  join public.profiles profile on profile.id = message.sender_id
  left join public.locations location
    on message.message_type = 'location'
   and coalesce(message.metadata->>'locationId', '') ~* '^[0-9a-f-]{36}$'
   and location.id = (message.metadata->>'locationId')::uuid
   and location.status = 'published'
  where message.conversation_id = target and message.deleted_at is null
  order by message.id asc
  limit 500;
end;
$$;

create or replace function public.social_send_message_v1(target uuid, message_body text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  mid bigint;
  peer uuid;
begin
  peer := public.social_conversation_peer_v2(target);
  if peer is null then raise exception 'Conversation unavailable.'; end if;
  if nullif(trim(message_body), '') is null then raise exception 'Message is empty.'; end if;

  insert into public.messages(conversation_id, sender_id, body, message_type, metadata)
  values (target, auth.uid(), left(trim(message_body), 5000), 'text', '{}'::jsonb)
  returning id into mid;

  update public.conversations set updated_at = now() where id = target;
  perform public.queue_notification_v1(
    peer,
    auth.uid(),
    'message',
    'New message',
    left(trim(message_body), 180),
    '/matches?tab=messages&conversation=' || target::text,
    jsonb_build_object('conversationId', target, 'messageId', mid)
  );
  return mid;
end;
$$;

create or replace function public.social_send_location_message_v1(target uuid, target_location uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  mid bigint;
  peer uuid;
  place_name text;
begin
  peer := public.social_conversation_peer_v2(target);
  if peer is null then raise exception 'Conversation unavailable.'; end if;
  select location.name into place_name
  from public.locations location
  where location.id = target_location and location.status = 'published';
  if place_name is null then raise exception 'Location unavailable.'; end if;

  insert into public.messages(conversation_id, sender_id, body, message_type, metadata)
  values (target, auth.uid(), 'Shared a place', 'location', jsonb_build_object('locationId', target_location))
  returning id into mid;

  update public.conversations set updated_at = now() where id = target;
  perform public.queue_notification_v1(
    peer,
    auth.uid(),
    'message',
    'Place shared with you',
    left(place_name, 180),
    '/matches?tab=messages&conversation=' || target::text,
    jsonb_build_object('conversationId', target, 'messageId', mid, 'locationId', target_location)
  );
  return mid;
end;
$$;

create or replace function public.pass_location_heatmap_v1()
returns table(
  location_id uuid,
  name text,
  latitude double precision,
  longitude double precision,
  save_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    location.id,
    location.name,
    location.latitude,
    location.longitude,
    count(distinct state.profile_id) as save_count
  from public.locations location
  join public.user_content_states state
    on state.location_id = location.id and state.state = 'saved'
  join public.profiles saver on saver.id = state.profile_id and saver.suspended_at is null
  where public.puddle_tinder_active_v1(auth.uid())
    and location.status = 'published'
    and location.visibility = 'public'
    and not coalesce(location.has_private_address, false)
    and location.latitude is not null
    and location.longitude is not null
  group by location.id, location.name, location.latitude, location.longitude
  order by count(distinct state.profile_id) desc, location.name
  limit 500
$$;

create or replace function public.pass_location_savers_v1(target_location uuid)
returns table(
  id uuid,
  display_name text,
  username text,
  avatar_path text,
  saved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  allowed boolean := false;
begin
  if actor is null or not public.puddle_tinder_active_v1(actor) then
    raise exception 'Puddle Pass required.';
  end if;

  select exists (
    select 1
    from public.locations location
    where location.id = target_location
      and (
        location.created_by = actor
        or (location.host_profile_id is not null and public.has_host_role(location.host_profile_id, array['owner','editor']))
        or public.is_admin()
      )
  ) into allowed;

  if not allowed then raise exception 'Location unavailable.'; end if;

  return query
  select
    profile.id,
    profile.display_name,
    profile.username,
    profile.avatar_path,
    state.created_at
  from public.user_content_states state
  join public.profiles profile on profile.id = state.profile_id
  where state.location_id = target_location
    and state.state = 'saved'
    and profile.suspended_at is null
    and coalesce(profile.profile_visibility, 'public') <> 'hidden'
    and not exists (
      select 1 from public.blocks block
      where (block.blocker_id = actor and block.blocked_id = profile.id)
         or (block.blocker_id = profile.id and block.blocked_id = actor)
    )
  order by state.created_at desc;
end;
$$;

drop policy if exists "users create locations" on public.locations;
create policy "pass users create locations"
on public.locations
for insert
to authenticated
with check (
  created_by = auth.uid()
  and (public.puddle_tinder_active_v1(auth.uid()) or public.is_admin())
  and (
    host_profile_id is null
    or public.has_host_role(host_profile_id, array['owner','editor'])
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

revoke all on function public.pass_can_message_profile_v1(uuid) from public, anon;
revoke all on function public.pass_message_search_v1(text) from public, anon;
revoke all on function public.pass_open_direct_conversation_v1(uuid) from public, anon;
revoke all on function public.social_conversation_peer_v2(uuid) from public, anon;
revoke all on function public.social_conversations_v1() from public, anon;
revoke all on function public.social_messages_v1(uuid) from public, anon;
revoke all on function public.social_send_message_v1(uuid, text) from public, anon;
revoke all on function public.social_send_location_message_v1(uuid, uuid) from public, anon;
revoke all on function public.pass_location_heatmap_v1() from public, anon;
revoke all on function public.pass_location_savers_v1(uuid) from public, anon;

grant execute on function public.pass_can_message_profile_v1(uuid) to authenticated;
grant execute on function public.pass_message_search_v1(text) to authenticated;
grant execute on function public.pass_open_direct_conversation_v1(uuid) to authenticated;
grant execute on function public.social_conversation_peer_v2(uuid) to authenticated;
grant execute on function public.social_conversations_v1() to authenticated;
grant execute on function public.social_messages_v1(uuid) to authenticated;
grant execute on function public.social_send_message_v1(uuid, text) to authenticated;
grant execute on function public.social_send_location_message_v1(uuid, uuid) to authenticated;
grant execute on function public.pass_location_heatmap_v1() to authenticated;
grant execute on function public.pass_location_savers_v1(uuid) to authenticated;
