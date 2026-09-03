begin;

-- The mobile conversation list does not load the message history until a
-- conversation is selected. Expose the latest shared location ID from the
-- same summary query so the application can hydrate all visible place names
-- in one batched B2 lookup.
drop function if exists public.social_conversations_v2(timestamptz,uuid,integer);
drop function if exists public.social_conversation_v2(uuid);

create function public.social_conversations_v2(
  before_sort_at timestamptz default null,
  before_conversation_id uuid default null,
  result_limit integer default 30
)
returns table(
  conversation_id uuid,
  friend_id uuid,
  display_name text,
  username text,
  avatar_path text,
  last_message text,
  last_message_type text,
  last_message_at timestamptz,
  last_location_id uuid,
  unread_count bigint,
  sort_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with input as (
    select auth.uid() actor,
      before_sort_at cursor_at,
      before_conversation_id cursor_id,
      greatest(1,least(coalesce(result_limit,30),100)) lim
  ), direct as materialized (
    select c.id conversation_id,
      peer.profile_id friend_id,
      c.pass_initiated_by,
      latest.body last_message,
      latest.message_type last_message_type,
      latest.created_at last_message_at,
      latest.location_id last_location_id,
      coalesce(latest.created_at,c.updated_at,c.created_at) sort_at,
      (select count(*)::bigint
       from public.messages unread
       where unread.conversation_id=c.id
         and unread.deleted_at is null
         and unread.sender_id<>i.actor
         and unread.id>coalesce(mine.last_read_message_id,0)) unread_count
    from input i
    join public.conversation_members mine
      on mine.profile_id=i.actor and mine.left_at is null
    join public.conversations c
      on c.id=mine.conversation_id and c.kind='direct'
    join public.conversation_members peer
      on peer.conversation_id=c.id
      and peer.profile_id<>i.actor
      and peer.left_at is null
    left join lateral (
      select m.body,
        m.message_type,
        m.created_at,
        case
          when m.message_type='location'
            and coalesce(m.metadata->>'locationId','') ~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (m.metadata->>'locationId')::uuid
        end location_id
      from public.messages m
      where m.conversation_id=c.id and m.deleted_at is null
      order by m.id desc
      limit 1
    ) latest on true
    where i.cursor_at is null
      or (coalesce(latest.created_at,c.updated_at,c.created_at),c.id)
        < (i.cursor_at,i.cursor_id)
  )
  select d.conversation_id,
    p.id,
    p.display_name,
    p.username,
    p.avatar_path,
    d.last_message,
    d.last_message_type,
    d.last_message_at,
    d.last_location_id,
    d.unread_count,
    d.sort_at
  from direct d
  cross join input i
  join public.profiles p
    on p.id=d.friend_id and p.suspended_at is null
  where not exists(
      select 1
      from public.blocks b
      where (b.blocker_id=i.actor and b.blocked_id=p.id)
        or (b.blocker_id=p.id and b.blocked_id=i.actor)
    )
    and (d.pass_initiated_by is not null or public.profiles_are_friends(i.actor,p.id))
  order by d.sort_at desc,d.conversation_id desc
  limit (select lim from input);
$$;

create function public.social_conversation_v2(target uuid)
returns table(
  conversation_id uuid,
  friend_id uuid,
  display_name text,
  username text,
  avatar_path text,
  last_message text,
  last_message_type text,
  last_message_at timestamptz,
  last_location_id uuid,
  unread_count bigint,
  sort_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with input as (select auth.uid() actor), direct as (
    select c.id conversation_id,
      peer.profile_id friend_id,
      c.pass_initiated_by,
      latest.body last_message,
      latest.message_type last_message_type,
      latest.created_at last_message_at,
      latest.location_id last_location_id,
      coalesce(latest.created_at,c.updated_at,c.created_at) sort_at,
      (select count(*)::bigint
       from public.messages unread
       where unread.conversation_id=c.id
         and unread.deleted_at is null
         and unread.sender_id<>i.actor
         and unread.id>coalesce(mine.last_read_message_id,0)) unread_count
    from input i
    join public.conversation_members mine
      on mine.profile_id=i.actor and mine.left_at is null
    join public.conversations c
      on c.id=mine.conversation_id and c.kind='direct' and c.id=target
    join public.conversation_members peer
      on peer.conversation_id=c.id
      and peer.profile_id<>i.actor
      and peer.left_at is null
    left join lateral (
      select m.body,
        m.message_type,
        m.created_at,
        case
          when m.message_type='location'
            and coalesce(m.metadata->>'locationId','') ~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (m.metadata->>'locationId')::uuid
        end location_id
      from public.messages m
      where m.conversation_id=c.id and m.deleted_at is null
      order by m.id desc
      limit 1
    ) latest on true
  )
  select d.conversation_id,
    p.id,
    p.display_name,
    p.username,
    p.avatar_path,
    d.last_message,
    d.last_message_type,
    d.last_message_at,
    d.last_location_id,
    d.unread_count,
    d.sort_at
  from direct d
  cross join input i
  join public.profiles p
    on p.id=d.friend_id and p.suspended_at is null
  where not exists(
      select 1
      from public.blocks b
      where (b.blocker_id=i.actor and b.blocked_id=p.id)
        or (b.blocker_id=p.id and b.blocked_id=i.actor)
    )
    and (d.pass_initiated_by is not null or public.profiles_are_friends(i.actor,p.id));
$$;

revoke all on function public.social_conversations_v2(timestamptz,uuid,integer) from public,anon;
revoke all on function public.social_conversation_v2(uuid) from public,anon;
grant execute on function public.social_conversations_v2(timestamptz,uuid,integer) to authenticated,service_role;
grant execute on function public.social_conversation_v2(uuid) to authenticated,service_role;

commit;
