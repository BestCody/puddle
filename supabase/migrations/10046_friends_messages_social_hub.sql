-- Friends, direct messaging, shared places, and social discovery helpers.
-- Intentionally notification-free: this social hub does not depend on the removed
-- notification/PWA delivery path.

create or replace function public.social_send_friend_request_v1(target uuid)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare actor uuid:=auth.uid();
begin
  if actor is null then raise exception 'Authentication required.'; end if;
  if target is null or actor=target then raise exception 'Profile unavailable.'; end if;
  if exists(select 1 from public.blocks where (blocker_id=actor and blocked_id=target) or (blocker_id=target and blocked_id=actor)) then
    raise exception 'Profile unavailable.';
  end if;
  if not coalesce((select allow_friend_requests from public.profiles where id=target and suspended_at is null),false) then
    raise exception 'Friend requests are disabled.';
  end if;

  if exists(select 1 from public.friendships where requester_id=target and addressee_id=actor and state='pending') then
    update public.friendships set state='accepted',created_at=now()
    where requester_id=target and addressee_id=actor;
    return 'accepted';
  end if;

  if exists(select 1 from public.friendships where requester_id=actor and addressee_id=target and state='accepted')
    or exists(select 1 from public.friendships where requester_id=target and addressee_id=actor and state='accepted') then
    return 'accepted';
  end if;

  insert into public.friendships(requester_id,addressee_id,state,created_at)
  values(actor,target,'pending',now())
  on conflict(requester_id,addressee_id) do update set state='pending',created_at=now();
  return 'pending';
end;
$$;

create or replace function public.social_respond_friend_request_v1(target uuid,response text)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare next_state text;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if response not in ('accept','decline') then raise exception 'Response is invalid.'; end if;
  next_state:=case when response='accept' then 'accepted' else 'declined' end;
  update public.friendships set state=next_state
  where requester_id=target and addressee_id=auth.uid() and state='pending';
  if not found then raise exception 'Friend request is unavailable.'; end if;
  return next_state;
end;
$$;

create or replace function public.social_remove_friend_v1(target uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  update public.friendships set state='removed'
  where (requester_id=auth.uid() and addressee_id=target)
     or (requester_id=target and addressee_id=auth.uid());
  delete from public.friend_close_friends
  where (profile_id=auth.uid() and friend_id=target)
     or (profile_id=target and friend_id=auth.uid());
  return true;
end;
$$;

create or replace function public.social_block_profile_v1(target uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null or target=auth.uid() then raise exception 'Profile unavailable.'; end if;
  insert into public.blocks(blocker_id,blocked_id) values(auth.uid(),target) on conflict do nothing;
  perform public.social_remove_friend_v1(target);
  return true;
end;
$$;

create or replace function public.social_friend_search_v1(search_term text)
returns table(
  id uuid,display_name text,username text,city text,bio text,avatar_path text,
  mutual_count bigint,is_friend boolean,request_state text,request_direction text
)
language sql
stable
security definer
set search_path=public
as $$
  with candidates as (
    select p.id,p.display_name,p.username,p.city,p.bio,p.avatar_path
    from public.profiles p
    where p.id<>auth.uid()
      and p.suspended_at is null
      and not exists(select 1 from public.blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=auth.uid()))
      and (p.allow_friend_requests or public.profiles_are_friends(auth.uid(),p.id))
      and (
        p.username ilike '%'||trim(leading '@' from coalesce(search_term,''))||'%'
        or p.display_name ilike '%'||trim(coalesce(search_term,''))||'%'
      )
    order by p.display_name nulls last,p.username nulls last
    limit 30
  )
  select c.*,
    (select count(*) from public.profiles m where public.profiles_are_friends(auth.uid(),m.id) and public.profiles_are_friends(c.id,m.id)) as mutual_count,
    public.profiles_are_friends(auth.uid(),c.id) as is_friend,
    rel.state as request_state,
    case when rel.requester_id=auth.uid() then 'outgoing' when rel.addressee_id=auth.uid() then 'incoming' end as request_direction
  from candidates c
  left join lateral (
    select f.requester_id,f.addressee_id,f.state
    from public.friendships f
    where (f.requester_id=auth.uid() and f.addressee_id=c.id) or (f.requester_id=c.id and f.addressee_id=auth.uid())
    order by case f.state when 'accepted' then 0 when 'pending' then 1 else 2 end,f.created_at desc
    limit 1
  ) rel on true;
$$;

create or replace function public.social_friends_v1()
returns table(
  id uuid,display_name text,username text,city text,bio text,avatar_path text,
  conversation_id uuid,places_in_common bigint
)
language sql
stable
security definer
set search_path=public
as $$
  with friend_ids as (
    select case when f.requester_id=auth.uid() then f.addressee_id else f.requester_id end id
    from public.friendships f
    where f.state='accepted' and (f.requester_id=auth.uid() or f.addressee_id=auth.uid())
  )
  select p.id,p.display_name,p.username,p.city,p.bio,p.avatar_path,
    (
      select c.id from public.conversations c
      where c.kind='direct'
        and exists(select 1 from public.conversation_members me where me.conversation_id=c.id and me.profile_id=auth.uid() and me.left_at is null)
        and exists(select 1 from public.conversation_members them where them.conversation_id=c.id and them.profile_id=p.id and them.left_at is null)
      order by c.updated_at desc nulls last,c.created_at desc
      limit 1
    ) conversation_id,
    (
      select count(distinct mine.location_id)
      from public.user_content_states mine
      join public.user_content_states theirs on theirs.profile_id=p.id and theirs.location_id=mine.location_id and theirs.state in ('saved','interested')
      where mine.profile_id=auth.uid() and mine.location_id is not null and mine.state in ('saved','interested')
    ) places_in_common
  from friend_ids f
  join public.profiles p on p.id=f.id and p.suspended_at is null
  where not exists(select 1 from public.blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=auth.uid()))
  order by p.display_name nulls last,p.username nulls last;
$$;

create or replace function public.social_friend_requests_v1()
returns table(
  id uuid,display_name text,username text,city text,avatar_path text,direction text,created_at timestamptz
)
language sql
stable
security definer
set search_path=public
as $$
  select p.id,p.display_name,p.username,p.city,p.avatar_path,
    case when f.addressee_id=auth.uid() then 'incoming' else 'outgoing' end direction,
    f.created_at
  from public.friendships f
  join public.profiles p on p.id=case when f.addressee_id=auth.uid() then f.requester_id else f.addressee_id end
  where f.state='pending' and (f.requester_id=auth.uid() or f.addressee_id=auth.uid())
    and not exists(select 1 from public.blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=auth.uid()))
  order by f.created_at desc;
$$;

create or replace function public.social_open_direct_conversation_v1(target uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare cid uuid;
begin
  if not public.profiles_are_friends(auth.uid(),target) then raise exception 'Friend unavailable.'; end if;
  select c.id into cid
  from public.conversations c
  where c.kind='direct'
    and exists(select 1 from public.conversation_members me where me.conversation_id=c.id and me.profile_id=auth.uid() and me.left_at is null)
    and exists(select 1 from public.conversation_members them where them.conversation_id=c.id and them.profile_id=target and them.left_at is null)
  order by c.updated_at desc nulls last,c.created_at desc
  limit 1;
  if cid is null then
    insert into public.conversations(kind,created_by,updated_at) values('direct',auth.uid(),now()) returning id into cid;
    insert into public.conversation_members(conversation_id,profile_id,member_role)
    values(cid,auth.uid(),'owner'),(cid,target,'member');
  end if;
  return cid;
end;
$$;

create or replace function public.social_conversations_v1()
returns table(
  conversation_id uuid,friend_id uuid,display_name text,username text,avatar_path text,
  last_message text,last_message_type text,last_message_at timestamptz,unread_count bigint
)
language sql
stable
security definer
set search_path=public
as $$
  with mine as (
    select cm.conversation_id,cm.last_read_message_id
    from public.conversation_members cm
    join public.conversations c on c.id=cm.conversation_id and c.kind='direct'
    where cm.profile_id=auth.uid() and cm.left_at is null
  ), peers as (
    select mine.conversation_id,mine.last_read_message_id,cm.profile_id friend_id
    from mine
    join public.conversation_members cm on cm.conversation_id=mine.conversation_id and cm.profile_id<>auth.uid() and cm.left_at is null
  )
  select peers.conversation_id,p.id,p.display_name,p.username,p.avatar_path,
    lm.body,lm.message_type,lm.created_at,
    (select count(*) from public.messages unread where unread.conversation_id=peers.conversation_id and unread.sender_id<>auth.uid() and unread.deleted_at is null and unread.id>coalesce(peers.last_read_message_id,0)) unread_count
  from peers
  join public.profiles p on p.id=peers.friend_id
  left join lateral (
    select m.body,m.message_type,m.created_at from public.messages m
    where m.conversation_id=peers.conversation_id and m.deleted_at is null
    order by m.id desc limit 1
  ) lm on true
  where public.profiles_are_friends(auth.uid(),p.id)
  order by lm.created_at desc nulls last,p.display_name;
$$;

create or replace function public.social_messages_v1(target uuid)
returns table(
  id bigint,sender_id uuid,sender_name text,sender_avatar_path text,body text,message_type text,
  metadata jsonb,edited_at timestamptz,created_at timestamptz,
  location_id uuid,location_name text,location_city text,location_slug text,location_cover_path text
)
language plpgsql
stable
security definer
set search_path=public
as $$
begin
  if not public.is_conversation_member(target) then raise exception 'Conversation unavailable.'; end if;
  return query
  select m.id,m.sender_id,coalesce(p.display_name,p.username,'Someone'),p.avatar_path,m.body,m.message_type,m.metadata,m.edited_at,m.created_at,
    l.id,l.name,l.city,l.slug,l.cover_path
  from public.messages m
  join public.profiles p on p.id=m.sender_id
  left join public.locations l on m.message_type='location'
    and coalesce(m.metadata->>'locationId','') ~* '^[0-9a-f-]{36}$'
    and l.id=(m.metadata->>'locationId')::uuid
    and l.status='published'
  where m.conversation_id=target and m.deleted_at is null
  order by m.id asc
  limit 500;
end;
$$;

create or replace function public.social_send_message_v1(target uuid,message_body text)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare mid bigint;
begin
  if not public.is_conversation_member(target) then raise exception 'Conversation unavailable.'; end if;
  if nullif(trim(message_body),'') is null then raise exception 'Message is empty.'; end if;
  insert into public.messages(conversation_id,sender_id,body,message_type,metadata)
  values(target,auth.uid(),left(trim(message_body),5000),'text','{}'::jsonb)
  returning id into mid;
  update public.conversations set updated_at=now() where id=target;
  return mid;
end;
$$;

create or replace function public.social_mark_conversation_read_v1(target uuid,last_message bigint default null)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  update public.conversation_members
  set last_read_message_id=coalesce(last_message,(select max(id) from public.messages where conversation_id=target))
  where conversation_id=target and profile_id=auth.uid() and left_at is null;
  return found;
end;
$$;

create or replace function public.friends_who_liked_location_v1(target_location uuid)
returns table(id uuid,display_name text,username text,avatar_path text)
language sql
stable
security definer
set search_path=public
as $$
  with friend_ids as (
    select case when f.requester_id=auth.uid() then f.addressee_id else f.requester_id end id
    from public.friendships f
    where f.state='accepted' and (f.requester_id=auth.uid() or f.addressee_id=auth.uid())
  )
  select distinct p.id,p.display_name,p.username,p.avatar_path
  from friend_ids f
  join public.profiles p on p.id=f.id and p.suspended_at is null
  join public.user_content_states s on s.profile_id=p.id and s.location_id=target_location and s.state in ('saved','interested')
  where not exists(select 1 from public.blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=auth.uid()))
  order by p.display_name nulls last,p.username nulls last;
$$;

create or replace function public.shared_places_with_friend_v1(target_friend uuid)
returns table(location_id uuid,name text,slug text,city text,cover_path text,category text)
language plpgsql
stable
security definer
set search_path=public
as $$
begin
  if not public.profiles_are_friends(auth.uid(),target_friend) then raise exception 'Friend unavailable.'; end if;
  return query
  select distinct l.id,l.name,l.slug,l.city,l.cover_path,l.kind
  from public.user_content_states mine
  join public.user_content_states theirs on theirs.profile_id=target_friend and theirs.location_id=mine.location_id and theirs.state in ('saved','interested')
  join public.locations l on l.id=mine.location_id and l.status='published'
  where mine.profile_id=auth.uid() and mine.state in ('saved','interested') and mine.location_id is not null
  order by l.name;
end;
$$;

create or replace function public.send_location_to_friend_v1(target_friend uuid,target_location uuid,share_note text default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare cid uuid;sid bigint;mid bigint;place_name text;
begin
  if not public.profiles_are_friends(auth.uid(),target_friend) then raise exception 'Friend unavailable.'; end if;
  select name into place_name from public.locations where id=target_location and status='published';
  if place_name is null then raise exception 'Place unavailable.'; end if;
  cid:=public.social_open_direct_conversation_v1(target_friend);
  insert into public.content_shares(sender_id,recipient_id,location_id,note)
  values(auth.uid(),target_friend,target_location,left(nullif(trim(coalesce(share_note,'')),''),1000))
  returning id into sid;
  insert into public.messages(conversation_id,sender_id,body,message_type,metadata)
  values(cid,auth.uid(),coalesce(nullif(left(trim(coalesce(share_note,'')),5000),''),'Shared '||place_name),'location',jsonb_build_object('locationId',target_location,'shareId',sid))
  returning id into mid;
  update public.conversations set updated_at=now() where id=cid;
  return jsonb_build_object('conversationId',cid,'messageId',mid,'shareId',sid);
end;
$$;

create or replace function public.social_shared_locations_v1()
returns table(
  share_id bigint,friend_id uuid,friend_name text,friend_username text,friend_avatar_path text,
  direction text,note text,created_at timestamptz,location_id uuid,location_name text,location_city text,
  location_slug text,location_cover_path text
)
language sql
stable
security definer
set search_path=public
as $$
  select s.id,p.id,p.display_name,p.username,p.avatar_path,
    case when s.sender_id=auth.uid() then 'sent' else 'received' end,
    s.note,s.created_at,l.id,l.name,l.city,l.slug,l.cover_path
  from public.content_shares s
  join public.locations l on l.id=s.location_id and l.status='published'
  join public.profiles p on p.id=case when s.sender_id=auth.uid() then s.recipient_id else s.sender_id end
  where s.location_id is not null and (s.sender_id=auth.uid() or s.recipient_id=auth.uid())
    and public.profiles_are_friends(auth.uid(),p.id)
  order by s.created_at desc
  limit 200;
$$;

create or replace function public.remove_profile_photo_v1()
returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  update public.profiles set avatar_path=null,updated_at=now() where id=auth.uid();
  return found;
end;
$$;

revoke all on function public.social_send_friend_request_v1(uuid) from public,anon;
revoke all on function public.social_respond_friend_request_v1(uuid,text) from public,anon;
revoke all on function public.social_remove_friend_v1(uuid) from public,anon;
revoke all on function public.social_block_profile_v1(uuid) from public,anon;
revoke all on function public.social_friend_search_v1(text) from public,anon;
revoke all on function public.social_friends_v1() from public,anon;
revoke all on function public.social_friend_requests_v1() from public,anon;
revoke all on function public.social_open_direct_conversation_v1(uuid) from public,anon;
revoke all on function public.social_conversations_v1() from public,anon;
revoke all on function public.social_messages_v1(uuid) from public,anon;
revoke all on function public.social_send_message_v1(uuid,text) from public,anon;
revoke all on function public.social_mark_conversation_read_v1(uuid,bigint) from public,anon;
revoke all on function public.friends_who_liked_location_v1(uuid) from public,anon;
revoke all on function public.shared_places_with_friend_v1(uuid) from public,anon;
revoke all on function public.send_location_to_friend_v1(uuid,uuid,text) from public,anon;
revoke all on function public.social_shared_locations_v1() from public,anon;
revoke all on function public.remove_profile_photo_v1() from public,anon;

grant execute on function public.social_send_friend_request_v1(uuid),public.social_respond_friend_request_v1(uuid,text),
  public.social_remove_friend_v1(uuid),public.social_block_profile_v1(uuid),public.social_friend_search_v1(text),
  public.social_friends_v1(),public.social_friend_requests_v1(),public.social_open_direct_conversation_v1(uuid),
  public.social_conversations_v1(),public.social_messages_v1(uuid),public.social_send_message_v1(uuid,text),
  public.social_mark_conversation_read_v1(uuid,bigint),public.friends_who_liked_location_v1(uuid),
  public.shared_places_with_friend_v1(uuid),public.send_location_to_friend_v1(uuid,uuid,text),
  public.social_shared_locations_v1(),public.remove_profile_photo_v1() to authenticated;
