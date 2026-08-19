create or replace function public.social_friend_search_v2(search_term text, result_limit integer default 30)
returns table(
  id uuid, display_name text, username text, city text, bio text, avatar_path text,
  mutual_count bigint, is_friend boolean, request_state text, request_direction text
)
language sql stable security definer set search_path = ''
as $$
  with input as (
    select auth.uid() actor,
      lower(trim(leading '@' from coalesce(search_term, ''))) q,
      greatest(1, least(coalesce(result_limit, 30), 50)) lim
  ), actor_friends as (
    select f.addressee_id id from public.friendships f, input i
    where f.requester_id=i.actor and f.state='accepted'
    union
    select f.requester_id id from public.friendships f, input i
    where f.addressee_id=i.actor and f.state='accepted'
  ), candidates as materialized (
    select p.id,p.display_name,p.username,p.city,p.bio,p.avatar_path,
      lower(coalesce(p.display_name,p.username,'')) sort_name
    from public.profiles p,input i
    where i.actor is not null and i.q<>'' and p.id<>i.actor and p.suspended_at is null
      and not exists(select 1 from public.blocks b where (b.blocker_id=i.actor and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=i.actor))
      and (coalesce(p.allow_friend_requests,true) or exists(select 1 from actor_friends af where af.id=p.id))
      and (lower(coalesce(p.username,'')) like '%'||i.q||'%' or lower(coalesce(p.display_name,'')) like '%'||i.q||'%')
    order by case when lower(coalesce(p.username,''))=i.q then 0 when lower(coalesce(p.username,'')) like i.q||'%' then 1 when lower(coalesce(p.display_name,'')) like i.q||'%' then 2 else 3 end,
      sort_name,p.id
    limit (select lim from input)
  ), candidate_friends as (
    select c.id candidate_id,case when f.requester_id=c.id then f.addressee_id else f.requester_id end friend_id
    from candidates c join public.friendships f on f.state='accepted' and (f.requester_id=c.id or f.addressee_id=c.id)
  ), mutuals as (
    select cf.candidate_id,count(*)::bigint mutual_count
    from candidate_friends cf join actor_friends af on af.id=cf.friend_id
    group by cf.candidate_id
  ), relationships as (
    select distinct on (c.id) c.id candidate_id,f.requester_id,f.addressee_id,f.state
    from candidates c cross join input i
    left join public.friendships f on (f.requester_id=i.actor and f.addressee_id=c.id) or (f.requester_id=c.id and f.addressee_id=i.actor)
    order by c.id,case f.state when 'accepted' then 0 when 'pending' then 1 else 2 end,f.created_at desc nulls last
  )
  select c.id,c.display_name,c.username,c.city,c.bio,c.avatar_path,coalesce(m.mutual_count,0),
    exists(select 1 from actor_friends af where af.id=c.id),r.state,
    case when r.requester_id=i.actor then 'outgoing' when r.addressee_id=i.actor then 'incoming' end
  from candidates c cross join input i
  left join mutuals m on m.candidate_id=c.id
  left join relationships r on r.candidate_id=c.id
  order by c.sort_name,c.id;
$$;

create or replace function public.social_friends_v2(before_name text default null,before_id uuid default null,result_limit integer default 50)
returns table(
  id uuid,display_name text,username text,city text,bio text,avatar_path text,
  conversation_id uuid,places_in_common bigint,sort_name text
)
language sql stable security definer set search_path = ''
as $$
  with input as (
    select auth.uid() actor,nullif(lower(coalesce(before_name,'')),'') cursor_name,before_id cursor_id,
      greatest(1,least(coalesce(result_limit,50),100)) lim
  ), friend_ids as materialized (
    select f.addressee_id id from public.friendships f,input i where f.requester_id=i.actor and f.state='accepted'
    union
    select f.requester_id id from public.friendships f,input i where f.addressee_id=i.actor and f.state='accepted'
  ), friend_profiles as materialized (
    select p.id,p.display_name,p.username,p.city,p.bio,p.avatar_path,lower(coalesce(p.display_name,p.username,'')) sort_name
    from friend_ids f join public.profiles p on p.id=f.id and p.suspended_at is null cross join input i
    where not exists(select 1 from public.blocks b where (b.blocker_id=i.actor and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=i.actor))
      and (i.cursor_name is null or (lower(coalesce(p.display_name,p.username,'')),p.id)>(i.cursor_name,i.cursor_id))
    order by sort_name,p.id limit (select lim from input)
  ), direct_conversations as (
    select distinct on (peer.profile_id) peer.profile_id friend_id,c.id conversation_id
    from input i
    join public.conversation_members mine on mine.profile_id=i.actor and mine.left_at is null
    join public.conversations c on c.id=mine.conversation_id and c.kind='direct'
    join public.conversation_members peer on peer.conversation_id=c.id and peer.profile_id<>i.actor and peer.left_at is null
    join friend_profiles fp on fp.id=peer.profile_id
    order by peer.profile_id,c.updated_at desc,c.id desc
  ), actor_places as materialized (
    select distinct s.location_id from public.user_content_states s,input i
    where s.profile_id=i.actor and s.location_id is not null and s.state in ('saved','interested')
  ), common_counts as (
    select fp.id friend_id,count(distinct theirs.location_id)::bigint places_in_common
    from friend_profiles fp
    join public.user_content_states theirs on theirs.profile_id=fp.id and theirs.state in ('saved','interested') and theirs.location_id is not null
    join actor_places mine on mine.location_id=theirs.location_id
    group by fp.id
  )
  select fp.id,fp.display_name,fp.username,fp.city,fp.bio,fp.avatar_path,dc.conversation_id,coalesce(cc.places_in_common,0),fp.sort_name
  from friend_profiles fp
  left join direct_conversations dc on dc.friend_id=fp.id
  left join common_counts cc on cc.friend_id=fp.id
  order by fp.sort_name,fp.id;
$$;

create or replace function public.social_conversations_v2(before_sort_at timestamptz default null,before_conversation_id uuid default null,result_limit integer default 30)
returns table(
  conversation_id uuid,friend_id uuid,display_name text,username text,avatar_path text,
  last_message text,last_message_type text,last_message_at timestamptz,unread_count bigint,sort_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  with input as (
    select auth.uid() actor,before_sort_at cursor_at,before_conversation_id cursor_id,
      greatest(1,least(coalesce(result_limit,30),100)) lim
  ), direct as materialized (
    select c.id conversation_id,peer.profile_id friend_id,c.pass_initiated_by,
      latest.body last_message,latest.message_type last_message_type,latest.created_at last_message_at,
      coalesce(latest.created_at,c.updated_at,c.created_at) sort_at,
      (select count(*)::bigint from public.messages unread
       where unread.conversation_id=c.id and unread.deleted_at is null and unread.sender_id<>i.actor
         and unread.id>coalesce(mine.last_read_message_id,0)) unread_count
    from input i
    join public.conversation_members mine on mine.profile_id=i.actor and mine.left_at is null
    join public.conversations c on c.id=mine.conversation_id and c.kind='direct'
    join public.conversation_members peer on peer.conversation_id=c.id and peer.profile_id<>i.actor and peer.left_at is null
    left join lateral (
      select m.body,m.message_type,m.created_at from public.messages m
      where m.conversation_id=c.id and m.deleted_at is null order by m.id desc limit 1
    ) latest on true
    where i.cursor_at is null or (coalesce(latest.created_at,c.updated_at,c.created_at),c.id)<(i.cursor_at,i.cursor_id)
  )
  select d.conversation_id,p.id,p.display_name,p.username,p.avatar_path,d.last_message,d.last_message_type,d.last_message_at,d.unread_count,d.sort_at
  from direct d cross join input i
  join public.profiles p on p.id=d.friend_id and p.suspended_at is null
  where not exists(select 1 from public.blocks b where (b.blocker_id=i.actor and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=i.actor))
    and (d.pass_initiated_by is not null or public.profiles_are_friends(i.actor,p.id))
  order by d.sort_at desc,d.conversation_id desc
  limit (select lim from input);
$$;

create or replace function public.social_conversation_v2(target uuid)
returns table(
  conversation_id uuid,friend_id uuid,display_name text,username text,avatar_path text,
  last_message text,last_message_type text,last_message_at timestamptz,unread_count bigint,sort_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  with input as (select auth.uid() actor), direct as (
    select c.id conversation_id,peer.profile_id friend_id,c.pass_initiated_by,
      latest.body last_message,latest.message_type last_message_type,latest.created_at last_message_at,
      coalesce(latest.created_at,c.updated_at,c.created_at) sort_at,
      (select count(*)::bigint from public.messages unread
       where unread.conversation_id=c.id and unread.deleted_at is null and unread.sender_id<>i.actor
         and unread.id>coalesce(mine.last_read_message_id,0)) unread_count
    from input i
    join public.conversation_members mine on mine.profile_id=i.actor and mine.left_at is null
    join public.conversations c on c.id=mine.conversation_id and c.kind='direct' and c.id=target
    join public.conversation_members peer on peer.conversation_id=c.id and peer.profile_id<>i.actor and peer.left_at is null
    left join lateral (
      select m.body,m.message_type,m.created_at from public.messages m
      where m.conversation_id=c.id and m.deleted_at is null order by m.id desc limit 1
    ) latest on true
  )
  select d.conversation_id,p.id,p.display_name,p.username,p.avatar_path,d.last_message,d.last_message_type,d.last_message_at,d.unread_count,d.sort_at
  from direct d cross join input i
  join public.profiles p on p.id=d.friend_id and p.suspended_at is null
  where not exists(select 1 from public.blocks b where (b.blocker_id=i.actor and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=i.actor))
    and (d.pass_initiated_by is not null or public.profiles_are_friends(i.actor,p.id));
$$;

revoke all on function public.social_friend_search_v2(text,integer) from public,anon;
revoke all on function public.social_friends_v2(text,uuid,integer) from public,anon;
revoke all on function public.social_conversations_v2(timestamptz,uuid,integer) from public,anon;
revoke all on function public.social_conversation_v2(uuid) from public,anon;
grant execute on function public.social_friend_search_v2(text,integer) to authenticated,service_role;
grant execute on function public.social_friends_v2(text,uuid,integer) to authenticated,service_role;
grant execute on function public.social_conversations_v2(timestamptz,uuid,integer) to authenticated,service_role;
grant execute on function public.social_conversation_v2(uuid) to authenticated,service_role;
