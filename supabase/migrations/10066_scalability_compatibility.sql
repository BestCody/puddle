-- Finish the scalability cutover while keeping older clients bounded during deployment.

create or replace function public.social_conversation_v2(target uuid)
returns table(
  conversation_id uuid,friend_id uuid,display_name text,username text,avatar_path text,
  last_message text,last_message_type text,last_message_at timestamptz,unread_count bigint,sort_at timestamptz
)
language sql stable security definer set search_path=public
as $$
  select c.id,p.id,p.display_name,p.username,p.avatar_path,c.last_message_body,c.last_message_type,c.last_message_at,
    mine.unread_count,coalesce(c.last_message_at,c.updated_at,c.created_at)
  from public.conversations c
  join public.conversation_members mine on mine.conversation_id=c.id and mine.profile_id=auth.uid() and mine.left_at is null
  join public.conversation_members peer on peer.conversation_id=c.id and peer.profile_id<>auth.uid() and peer.left_at is null
  join public.profiles p on p.id=peer.profile_id and p.suspended_at is null
  where c.id=target and c.kind='direct'
    and not exists(select 1 from public.blocks b where (b.blocker_id=auth.uid() and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=auth.uid()))
    and (c.pass_initiated_by is not null or exists(
      select 1 from public.friendships f where f.state='accepted'
        and ((f.requester_id=auth.uid() and f.addressee_id=p.id) or (f.requester_id=p.id and f.addressee_id=auth.uid()))
    ))
  limit 1
$$;

-- A soft-deleted unread message must also leave the denormalized unread counter.
create or replace function public.sync_conversation_message_summary_v2()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if tg_op='INSERT' then
    update public.conversations set last_message_id=new.id,last_message_body=new.body,last_message_type=new.message_type,
      last_message_at=new.created_at,updated_at=greatest(coalesce(updated_at,new.created_at),new.created_at)
    where id=new.conversation_id;
    update public.conversation_members set unread_count=unread_count+1
    where conversation_id=new.conversation_id and profile_id<>new.sender_id and left_at is null;
    return new;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    update public.conversation_members
    set unread_count=greatest(0,unread_count-1)
    where conversation_id=new.conversation_id and profile_id<>new.sender_id and left_at is null
      and new.id>coalesce(last_read_message_id,0);

    if exists(select 1 from public.conversations c where c.id=new.conversation_id and c.last_message_id=new.id) then
      update public.conversations c
      set last_message_id=latest.id,last_message_body=latest.body,last_message_type=latest.message_type,last_message_at=latest.created_at
      from lateral (
        select m.id,m.body,m.message_type,m.created_at from public.messages m
        where m.conversation_id=new.conversation_id and m.deleted_at is null order by m.id desc limit 1
      ) latest where c.id=new.conversation_id;
    end if;
  elsif new.deleted_at is null then
    update public.conversations set last_message_body=new.body,last_message_type=new.message_type,last_message_at=new.created_at
    where id=new.conversation_id and last_message_id=new.id;
  end if;
  return new;
end;
$$;

-- Legacy public contracts now delegate to bounded/index-backed implementations.
create or replace function public.social_friend_search_v1(search_term text)
returns table(
  id uuid,display_name text,username text,city text,bio text,avatar_path text,
  mutual_count bigint,is_friend boolean,request_state text,request_direction text
)
language sql stable security definer set search_path=public
as $$ select * from public.social_friend_search_v2(search_term,30) $$;

create or replace function public.pass_message_search_v1(search_term text)
returns table(id uuid,display_name text,username text,city text,bio text,avatar_path text,is_friend boolean,can_message boolean)
language sql stable security definer set search_path=public
as $$ select * from public.pass_message_search_v2(search_term,30) $$;

create or replace function public.social_friends_v1()
returns table(
  id uuid,display_name text,username text,city text,bio text,avatar_path text,
  conversation_id uuid,places_in_common bigint
)
language sql stable security definer set search_path=public
as $$
  select f.id,f.display_name,f.username,f.city,f.bio,f.avatar_path,f.conversation_id,f.places_in_common
  from public.social_friends_v2(null,null,100) f
$$;

create or replace function public.social_conversations_v1()
returns table(
  conversation_id uuid,friend_id uuid,display_name text,username text,avatar_path text,
  last_message text,last_message_type text,last_message_at timestamptz,unread_count bigint
)
language sql stable security definer set search_path=public
as $$
  select c.conversation_id,c.friend_id,c.display_name,c.username,c.avatar_path,c.last_message,c.last_message_type,c.last_message_at,c.unread_count
  from public.social_conversations_v2(null,null,100) c
$$;

create or replace function public.social_messages_v1(target uuid)
returns table(
  id bigint,sender_id uuid,sender_name text,sender_avatar_path text,body text,message_type text,
  metadata jsonb,edited_at timestamptz,created_at timestamptz,location_id uuid,location_name text,
  location_city text,location_slug text,location_cover_path text
)
language sql stable security definer set search_path=public
as $$ select * from public.social_messages_v2(target,null,100) $$;

revoke all on function public.social_conversation_v2(uuid) from public,anon;
grant execute on function public.social_conversation_v2(uuid) to authenticated;
