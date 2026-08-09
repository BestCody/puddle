-- Direct social conversations are usable only while the peer remains an accepted friend.

create or replace function public.social_conversation_friend_v1(target uuid)
returns uuid
language sql
stable
security definer
set search_path=public
as $$
  select peer.profile_id
  from public.conversations c
  join public.conversation_members mine on mine.conversation_id=c.id and mine.profile_id=auth.uid() and mine.left_at is null
  join public.conversation_members peer on peer.conversation_id=c.id and peer.profile_id<>auth.uid() and peer.left_at is null
  where c.id=target and c.kind='direct' and public.profiles_are_friends(auth.uid(),peer.profile_id)
  limit 1
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
  if public.social_conversation_friend_v1(target) is null then raise exception 'Conversation unavailable.'; end if;
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
  if public.social_conversation_friend_v1(target) is null then raise exception 'Conversation unavailable.'; end if;
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
  if public.social_conversation_friend_v1(target) is null then raise exception 'Conversation unavailable.'; end if;
  update public.conversation_members
  set last_read_message_id=coalesce(last_message,(select max(id) from public.messages where conversation_id=target))
  where conversation_id=target and profile_id=auth.uid() and left_at is null;
  return found;
end;
$$;

revoke all on function public.social_conversation_friend_v1(uuid) from public,anon;
revoke all on function public.social_messages_v1(uuid) from public,anon;
revoke all on function public.social_send_message_v1(uuid,text) from public,anon;
revoke all on function public.social_mark_conversation_read_v1(uuid,bigint) from public,anon;

grant execute on function public.social_conversation_friend_v1(uuid),public.social_messages_v1(uuid),
  public.social_send_message_v1(uuid,text),public.social_mark_conversation_read_v1(uuid,bigint) to authenticated;
