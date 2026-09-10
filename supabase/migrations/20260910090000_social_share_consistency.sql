begin;

-- Location shares have two projections: the canonical share ledger and the
-- conversation message. Keep one request key across both projections so a
-- retry cannot create a second share or message.
alter table public.content_shares
  add column if not exists share_key uuid;
alter table public.messages
  add column if not exists share_key uuid;

create unique index if not exists content_shares_share_key_unique_idx
  on public.content_shares(share_key)
  where share_key is not null;
create unique index if not exists messages_share_key_unique_idx
  on public.messages(share_key)
  where share_key is not null;
create index if not exists content_shares_location_recipient_created_idx
  on public.content_shares(recipient_id,created_at desc,id desc)
  where location_id is not null;
create index if not exists content_shares_location_sender_created_idx
  on public.content_shares(sender_id,created_at desc,id desc)
  where location_id is not null;

-- Direct conversations are identified by the unordered pair of active
-- members. Existing duplicate rows are preserved, but only the newest row for
-- each pair receives the canonical key; new rows are then protected by the
-- unique partial index below.
alter table public.conversations
  add column if not exists direct_pair_key text;

with pairs as (
  select c.id,
    string_agg(cm.profile_id::text,':' order by cm.profile_id) pair_key
  from public.conversations c
  join public.conversation_members cm
    on cm.conversation_id=c.id and cm.left_at is null
  where c.kind='direct'
  group by c.id
  having count(*)=2
), ranked as (
  select pairs.id,pairs.pair_key,
    row_number() over(
      partition by pairs.pair_key
      order by c.updated_at desc nulls last,c.created_at desc,c.id desc
    ) pair_rank
  from pairs
  join public.conversations c on c.id=pairs.id
)
update public.conversations c
set direct_pair_key=ranked.pair_key
from ranked
where c.id=ranked.id and ranked.pair_rank=1;

create unique index if not exists conversations_direct_pair_unique_idx
  on public.conversations(direct_pair_key)
  where kind='direct' and direct_pair_key is not null;
create index if not exists conversations_direct_pair_lookup_idx
  on public.conversations(direct_pair_key)
  where kind='direct';

drop function if exists public.social_open_direct_conversation_v1(uuid);
create function public.social_open_direct_conversation_v1(target uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid:=auth.uid();
  cid uuid;
  pair_key text;
begin
  if actor is null or target is null or actor=target then
    raise exception 'Friend unavailable.';
  end if;
  if not public.profiles_are_friends(actor,target) then
    raise exception 'Friend unavailable.';
  end if;

  pair_key:=least(actor::text,target::text)||':'||greatest(actor::text,target::text);
  perform pg_advisory_xact_lock(hashtextextended(pair_key,0));

  select c.id into cid
  from public.conversations c
  where c.kind='direct'
    and exists(
      select 1 from public.conversation_members me
      where me.conversation_id=c.id and me.profile_id=actor and me.left_at is null
    )
    and exists(
      select 1 from public.conversation_members them
      where them.conversation_id=c.id and them.profile_id=target and them.left_at is null
    )
  order by (c.direct_pair_key=pair_key) desc nulls last,c.updated_at desc nulls last,c.created_at desc,c.id desc
  limit 1;

  if cid is null then
    insert into public.conversations(kind,created_by,updated_at,direct_pair_key)
    values('direct',actor,now(),pair_key)
    returning id into cid;
    insert into public.conversation_members(conversation_id,profile_id,member_role)
    values(cid,actor,'owner'),(cid,target,'member');
  elsif (select direct_pair_key from public.conversations where id=cid) is null then
    update public.conversations set direct_pair_key=pair_key where id=cid;
  end if;
  return cid;
end;
$$;

revoke all on function public.social_open_direct_conversation_v1(uuid) from public,anon;
grant execute on function public.social_open_direct_conversation_v1(uuid) to authenticated,service_role;

-- One transaction owns both the Shared ledger row and the chat projection.
-- target_conversation is used by the in-chat picker; external share surfaces
-- resolve the canonical direct conversation from the friend ID.
create or replace function public.social_share_location_v2(
  target_friend uuid,
  target_location uuid,
  request_key uuid,
  share_note text default null,
  target_conversation uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid:=auth.uid();
  recipient uuid;
  cid uuid;
  sid bigint;
  mid bigint;
  existing_recipient uuid;
  existing_location uuid;
begin
  if actor is null then raise exception 'Authentication required.'; end if;
  if request_key is null then raise exception 'Share request is invalid.'; end if;
  if target_location is null then raise exception 'Place unavailable.'; end if;

  -- Serialize retries for the same idempotency key. The unique indexes protect
  -- the rows, while this transaction lock lets a concurrent retry wait for the
  -- first transaction to create both projections before reading its result.
  perform pg_advisory_xact_lock(hashtextextended('social-share:'||request_key::text,0));

  -- A retried request returns the original result without re-queuing a
  -- notification. A request key cannot be reused for another destination.
  select s.id,s.recipient_id,s.location_id
  into sid,existing_recipient,existing_location
  from public.content_shares s
  where s.sender_id=actor and s.share_key=request_key;
  if sid is not null then
    if existing_recipient is distinct from coalesce(target_friend,existing_recipient)
      or existing_location is distinct from target_location then
      raise exception 'Share request was already used.';
    end if;
    select m.id,m.conversation_id into mid,cid
    from public.messages m
    where m.share_key=request_key and m.message_type='location'
    limit 1;
    if mid is null then raise exception 'Share request could not be recovered.'; end if;
    return jsonb_build_object('conversationId',cid,'messageId',mid,'shareId',sid);
  end if;

  if not exists(select 1 from public.location_refs where id=target_location) then
    raise exception 'Place unavailable.';
  end if;

  if target_conversation is not null then
    cid:=target_conversation;
    recipient:=public.social_conversation_peer_v2(cid);
    if recipient is null then raise exception 'Conversation unavailable.'; end if;
    if target_friend is not null and target_friend<>recipient then
      raise exception 'Conversation unavailable.';
    end if;
  else
    recipient:=target_friend;
    if recipient is null or not public.profiles_are_friends(actor,recipient) then
      raise exception 'Friend unavailable.';
    end if;
    cid:=public.social_open_direct_conversation_v1(recipient);
  end if;

  insert into public.content_shares(sender_id,recipient_id,location_id,note,share_key)
  values(actor,recipient,target_location,left(nullif(trim(coalesce(share_note,'')),''),1000),request_key)
  on conflict (share_key) where share_key is not null do nothing
  returning id into sid;

  if sid is null then
    select s.id,s.recipient_id,s.location_id
    into sid,existing_recipient,existing_location
    from public.content_shares s
    where s.sender_id=actor and s.share_key=request_key;
    if sid is null
      or existing_recipient is distinct from coalesce(target_friend,existing_recipient)
      or existing_location is distinct from target_location then
      raise exception 'Share request could not be recovered.';
    end if;
    select m.id,m.conversation_id into mid,cid
    from public.messages m
    where m.share_key=request_key and m.message_type='location'
    limit 1;
    if mid is null then raise exception 'Share request could not be recovered.'; end if;
    return jsonb_build_object('conversationId',cid,'messageId',mid,'shareId',sid);
  end if;

  insert into public.messages(conversation_id,sender_id,body,message_type,metadata,share_key)
  values(
    cid,actor,
    coalesce(nullif(left(trim(coalesce(share_note,'')),5000),''),'Shared a place'),
    'location',
    jsonb_build_object('locationId',target_location,'shareId',sid,'shareKey',request_key),
    request_key
  )
  on conflict (share_key) where share_key is not null do nothing
  returning id into mid;
  if mid is null then
    select m.id,m.conversation_id into mid,cid
    from public.messages m
    where m.share_key=request_key and m.message_type='location'
    limit 1;
    if mid is null then raise exception 'Share request could not be recovered.'; end if;
  end if;

  update public.conversations set updated_at=now() where id=cid;
  perform public.queue_notification_v1(
    recipient,actor,'message','Place shared with you',
    coalesce(nullif(left(trim(coalesce(share_note,'')),180),''),'Shared a place'),
    '/matches?tab=messages&conversation='||cid::text,
    jsonb_build_object('conversationId',cid,'messageId',mid,'locationId',target_location,'shareId',sid)
  );
  return jsonb_build_object('conversationId',cid,'messageId',mid,'shareId',sid);
end;
$$;

revoke all on function public.social_share_location_v2(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;

drop function if exists public.send_location_to_friend_v1(uuid,uuid,text);
create function public.send_location_to_friend_v1(
  target_friend uuid,
  target_location uuid,
  request_key uuid,
  share_note text default null
)
returns jsonb
language sql
security definer
set search_path=public
as $$
  select public.social_share_location_v2(target_friend,target_location,request_key,share_note,null);
$$;

revoke all on function public.send_location_to_friend_v1(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.send_location_to_friend_v1(uuid,uuid,uuid,text) to authenticated;

drop function if exists public.social_send_location_message_v1(uuid,uuid);
create function public.social_send_location_message_v1(
  target uuid,
  target_location uuid,
  request_key uuid
)
returns bigint
language sql
security definer
set search_path=public
as $$
  select (public.social_share_location_v2(null,target_location,request_key,'Shared a place',target)->>'messageId')::bigint;
$$;

revoke all on function public.social_send_location_message_v1(uuid,uuid,uuid) from public,anon;
grant execute on function public.social_send_location_message_v1(uuid,uuid,uuid) to authenticated;

-- The generic share entry point remains the authority for post/event/plan
-- shares. Place shares use the canonical location transaction above.
drop function if exists public.share_content_v1(text,uuid,uuid,uuid,text);
create function public.share_content_v1(
  target_kind text,
  target_id uuid,
  recipient_profile uuid default null,
  target_plan uuid default null,
  share_note text default null,
  request_key uuid default null
)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid:=auth.uid();
  sid bigint;
  existing_recipient uuid;
  existing_plan uuid;
  existing_event uuid;
  existing_post uuid;
begin
  if actor is null then raise exception 'Authentication required.'; end if;
  if target_kind not in ('event','place','post') then raise exception 'Share target is invalid.'; end if;
  if request_key is null then raise exception 'Share request is invalid.'; end if;
  if num_nonnulls(recipient_profile,target_plan)<>1 then raise exception 'destination required'; end if;
  if recipient_profile is not null and not public.profiles_are_friends(actor,recipient_profile) then raise exception 'friend unavailable'; end if;
  if target_plan is not null and not public.can_edit_plan(target_plan) then raise exception 'plan unavailable'; end if;

  if target_kind='place' then
    if recipient_profile is null then raise exception 'friend unavailable'; end if;
    return (public.social_share_location_v2(recipient_profile,target_id,request_key,share_note,null)->>'shareId')::bigint;
  end if;

  if target_kind='post' and not exists(
    select 1 from public.social_posts p
    where p.id=target_id and (
      p.author_id=actor or p.visibility='public'
      or (p.visibility='friends' and public.profiles_are_friends(actor,p.author_id))
    )
  ) then raise exception 'Post unavailable.'; end if;

  select s.id,s.recipient_id,s.plan_id,s.event_id,s.post_id
  into sid,existing_recipient,existing_plan,existing_event,existing_post
  from public.content_shares s
  where s.sender_id=actor and s.share_key=request_key;
  if sid is not null then
    if existing_recipient is distinct from recipient_profile
      or existing_plan is distinct from target_plan
      or (target_kind='event' and existing_event is distinct from target_id)
      or (target_kind='post' and existing_post is distinct from target_id) then
      raise exception 'Share request was already used.';
    end if;
    return sid;
  end if;

  insert into public.content_shares(sender_id,recipient_id,plan_id,event_id,location_id,post_id,note,share_key)
  values(
    actor,recipient_profile,target_plan,
    case when target_kind='event' then target_id end,
    null,
    case when target_kind='post' then target_id end,
    left(share_note,1000),request_key
  )
  on conflict (share_key) where share_key is not null do nothing
  returning id into sid;

  if sid is null then
    select s.id,s.recipient_id,s.plan_id,s.event_id,s.post_id
    into sid,existing_recipient,existing_plan,existing_event,existing_post
    from public.content_shares s
    where s.sender_id=actor and s.share_key=request_key;
    if sid is null
      or existing_recipient is distinct from recipient_profile
      or existing_plan is distinct from target_plan
      or (target_kind='event' and existing_event is distinct from target_id)
      or (target_kind='post' and existing_post is distinct from target_id) then
      raise exception 'Share request could not be recovered.';
    end if;
    return sid;
  end if;

  if recipient_profile is not null then
    perform public.queue_notification_v1(
      recipient_profile,actor,'share','Shared with you','A friend shared something with you.',
      case when target_kind='post' then '/map' else '/plans' end,
      jsonb_build_object('shareId',sid,'targetKind',target_kind,'targetId',target_id)
    );
  end if;
  return sid;
end;
$$;

revoke all on function public.share_content_v1(text,uuid,uuid,uuid,text,uuid) from public,anon;
grant execute on function public.share_content_v1(text,uuid,uuid,uuid,text,uuid) to authenticated;

-- Shared history is keyset paged instead of capped at a fixed first page.
drop function if exists public.social_shared_locations_v1();
create function public.social_shared_locations_v2(
  before_created_at timestamptz default null,
  before_share_id bigint default null,
  result_limit integer default 50
)
returns table(
  share_id bigint,friend_id uuid,friend_name text,friend_username text,friend_avatar_path text,
  direction text,note text,created_at timestamptz,location_id uuid,location_name text,
  location_city text,location_slug text,location_cover_path text
)
language sql
stable
security definer
set search_path=''
as $$
  with input as (
    select auth.uid() actor,before_created_at cursor_at,before_share_id cursor_id,
      greatest(1,least(coalesce(result_limit,50),100)) lim
  )
  select s.id,p.id,p.display_name,p.username,p.avatar_path,
    case when s.sender_id=i.actor then 'sent' else 'received' end,
    s.note,s.created_at,s.location_id,null::text,null::text,null::text,null::text
  from public.content_shares s
  cross join input i
  join public.location_refs ref on ref.id=s.location_id
  join public.profiles p on p.id=case when s.sender_id=i.actor then s.recipient_id else s.sender_id end
    and p.suspended_at is null
  where s.location_id is not null
    and (s.sender_id=i.actor or s.recipient_id=i.actor)
    and public.profiles_are_friends(i.actor,p.id)
    and (i.cursor_at is null or (s.created_at,s.id)<(i.cursor_at,i.cursor_id))
  order by s.created_at desc,s.id desc
  limit (select lim from input);
$$;

revoke all on function public.social_shared_locations_v2(timestamptz,bigint,integer) from public,anon;
grant execute on function public.social_shared_locations_v2(timestamptz,bigint,integer) to authenticated,service_role;

-- Make existing chat-only location messages visible in Shared history. This
-- is a one-time repair for rows written before the canonical transaction.
insert into public.content_shares(sender_id,recipient_id,location_id,note,share_key,created_at)
select m.sender_id,peer.profile_id,ref.id,null,gen_random_uuid(),m.created_at
from public.messages m
join public.conversation_members sender_member
  on sender_member.conversation_id=m.conversation_id
  and sender_member.profile_id=m.sender_id
  and sender_member.left_at is null
join lateral (
  select cm.profile_id
  from public.conversation_members cm
  where cm.conversation_id=m.conversation_id
    and cm.profile_id<>m.sender_id
    and cm.left_at is null
  order by cm.profile_id
  limit 1
) peer on true
join public.location_refs ref
  on ref.id=case
    when coalesce(m.metadata->>'locationId','') ~* '^[0-9a-f-]{36}$'
    then (m.metadata->>'locationId')::uuid
  end
where m.message_type='location'
  and m.deleted_at is null
  and coalesce(m.metadata->>'shareId','')=''
  and not exists(
    select 1 from public.content_shares existing
    where existing.sender_id=m.sender_id
      and existing.recipient_id=peer.profile_id
      and existing.location_id=ref.id
      and existing.created_at=m.created_at
  );

commit;
