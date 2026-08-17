-- Harden high-growth interactive paths for large user and catalogue volumes.
-- Replaces global aggregations, unbounded social reads, correlated friendship scans,
-- and non-paginated messaging with bounded/index-backed contracts.

create extension if not exists pg_trgm;

-- Search and relationship hot paths.
do $$
declare trigram_schema text;
begin
  select n.nspname into trigram_schema
  from pg_opclass o
  join pg_namespace n on n.oid = o.opcnamespace
  where o.opcname = 'gin_trgm_ops'
  limit 1;

  if trigram_schema is null then
    raise exception 'pg_trgm gin_trgm_ops is unavailable';
  end if;

  execute format(
    'create index if not exists profiles_username_trgm_idx on public.profiles using gin (lower(coalesce(username, '''')) %I.gin_trgm_ops)',
    trigram_schema
  );
  execute format(
    'create index if not exists profiles_display_name_trgm_idx on public.profiles using gin (lower(coalesce(display_name, '''')) %I.gin_trgm_ops)',
    trigram_schema
  );
end $$;

create index if not exists friendships_requester_state_addressee_idx
  on public.friendships(requester_id, state, addressee_id);
create index if not exists friendships_addressee_state_requester_idx
  on public.friendships(addressee_id, state, requester_id);
create index if not exists blocks_blocker_blocked_idx
  on public.blocks(blocker_id, blocked_id);
create index if not exists blocks_blocked_blocker_idx
  on public.blocks(blocked_id, blocker_id);
create index if not exists conversation_members_profile_active_idx
  on public.conversation_members(profile_id, conversation_id)
  where left_at is null;
create index if not exists conversation_members_conversation_active_idx
  on public.conversation_members(conversation_id, profile_id)
  where left_at is null;
create index if not exists messages_conversation_live_id_idx
  on public.messages(conversation_id, id desc)
  where deleted_at is null;
create index if not exists user_content_states_profile_state_location_idx
  on public.user_content_states(profile_id, state, location_id);
create index if not exists user_content_states_location_state_created_idx
  on public.user_content_states(location_id, state, created_at desc, profile_id);
create index if not exists social_comments_post_live_created_idx
  on public.social_comments(post_id, created_at desc, id desc)
  where post_id is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- Set-based profile/friend search.
-- ---------------------------------------------------------------------------
create or replace function public.social_friend_search_v2(
  search_term text,
  result_limit integer default 30
)
returns table(
  id uuid,
  display_name text,
  username text,
  city text,
  bio text,
  avatar_path text,
  mutual_count bigint,
  is_friend boolean,
  request_state text,
  request_direction text
)
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select auth.uid() actor,
      lower(trim(leading '@' from coalesce(search_term, ''))) q,
      greatest(1, least(coalesce(result_limit, 30), 50)) lim
  ), actor_friends as (
    select f.addressee_id id
    from public.friendships f, input i
    where f.requester_id = i.actor and f.state = 'accepted'
    union
    select f.requester_id id
    from public.friendships f, input i
    where f.addressee_id = i.actor and f.state = 'accepted'
  ), candidates as materialized (
    select p.id, p.display_name, p.username, p.city, p.bio, p.avatar_path,
      lower(coalesce(p.display_name, p.username, '')) sort_name
    from public.profiles p, input i
    where i.actor is not null
      and i.q <> ''
      and p.id <> i.actor
      and p.suspended_at is null
      and not exists (
        select 1 from public.blocks b
        where (b.blocker_id = i.actor and b.blocked_id = p.id)
           or (b.blocker_id = p.id and b.blocked_id = i.actor)
      )
      and (
        p.allow_friend_requests
        or exists (select 1 from actor_friends af where af.id = p.id)
      )
      and (
        lower(coalesce(p.username, '')) like '%' || i.q || '%'
        or lower(coalesce(p.display_name, '')) like '%' || i.q || '%'
      )
    order by
      case when lower(coalesce(p.username, '')) = i.q then 0
           when lower(coalesce(p.username, '')) like i.q || '%' then 1
           when lower(coalesce(p.display_name, '')) like i.q || '%' then 2
           else 3 end,
      sort_name,
      p.id
    limit (select lim from input)
  ), candidate_friends as (
    select c.id candidate_id,
      case when f.requester_id = c.id then f.addressee_id else f.requester_id end friend_id
    from candidates c
    join public.friendships f
      on f.state = 'accepted'
     and (f.requester_id = c.id or f.addressee_id = c.id)
  ), mutuals as (
    select cf.candidate_id, count(*)::bigint mutual_count
    from candidate_friends cf
    join actor_friends af on af.id = cf.friend_id
    group by cf.candidate_id
  ), relationships as (
    select distinct on (c.id)
      c.id candidate_id, f.requester_id, f.addressee_id, f.state
    from candidates c
    join input i on true
    left join public.friendships f
      on (f.requester_id = i.actor and f.addressee_id = c.id)
      or (f.requester_id = c.id and f.addressee_id = i.actor)
    order by c.id,
      case f.state when 'accepted' then 0 when 'pending' then 1 else 2 end,
      f.created_at desc nulls last
  )
  select c.id, c.display_name, c.username, c.city, c.bio, c.avatar_path,
    coalesce(m.mutual_count, 0),
    exists (select 1 from actor_friends af where af.id = c.id),
    r.state,
    case when r.requester_id = i.actor then 'outgoing'
         when r.addressee_id = i.actor then 'incoming' end
  from candidates c
  cross join input i
  left join mutuals m on m.candidate_id = c.id
  left join relationships r on r.candidate_id = c.id
  order by c.sort_name, c.id;
$$;

create or replace function public.pass_message_search_v2(
  search_term text,
  result_limit integer default 30
)
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
  with input as (
    select auth.uid() actor,
      lower(trim(leading '@' from coalesce(search_term, ''))) q,
      greatest(1, least(coalesce(result_limit, 30), 50)) lim
  ), actor_friends as (
    select f.addressee_id id from public.friendships f, input i
    where f.requester_id = i.actor and f.state = 'accepted'
    union
    select f.requester_id id from public.friendships f, input i
    where f.addressee_id = i.actor and f.state = 'accepted'
  ), candidates as materialized (
    select p.id, p.display_name, p.username, p.city, p.bio, p.avatar_path
    from public.profiles p, input i
    where i.actor is not null
      and public.puddle_tinder_active_v1(i.actor)
      and i.q <> ''
      and p.id <> i.actor
      and p.suspended_at is null
      and coalesce(p.profile_visibility, 'public') <> 'hidden'
      and public.puddle_adult_v1(p.id)
      and not exists (
        select 1 from public.blocks b
        where (b.blocker_id = i.actor and b.blocked_id = p.id)
           or (b.blocker_id = p.id and b.blocked_id = i.actor)
      )
      and (
        lower(coalesce(p.username, '')) like '%' || i.q || '%'
        or lower(coalesce(p.display_name, '')) like '%' || i.q || '%'
      )
    order by
      case when lower(coalesce(p.username, '')) = i.q then 0
           when lower(coalesce(p.username, '')) like i.q || '%' then 1
           when lower(coalesce(p.display_name, '')) like i.q || '%' then 2
           else 3 end,
      lower(coalesce(p.display_name, p.username, '')),
      p.id
    limit (select lim from input)
  )
  select c.id, c.display_name, c.username, c.city, c.bio, c.avatar_path,
    exists (select 1 from actor_friends af where af.id = c.id),
    public.pass_can_message_profile_v1(c.id)
  from candidates c
  order by lower(coalesce(c.display_name, c.username, '')), c.id;
$$;

-- ---------------------------------------------------------------------------
-- Bounded friends list with set-based conversation/shared-place metadata.
-- ---------------------------------------------------------------------------
create or replace function public.social_friends_v2(
  before_name text default null,
  before_id uuid default null,
  result_limit integer default 50
)
returns table(
  id uuid,
  display_name text,
  username text,
  city text,
  bio text,
  avatar_path text,
  conversation_id uuid,
  places_in_common bigint,
  sort_name text
)
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select auth.uid() actor,
      nullif(lower(coalesce(before_name, '')), '') cursor_name,
      before_id cursor_id,
      greatest(1, least(coalesce(result_limit, 50), 100)) lim
  ), friend_ids as materialized (
    select f.addressee_id id from public.friendships f, input i
    where f.requester_id = i.actor and f.state = 'accepted'
    union
    select f.requester_id id from public.friendships f, input i
    where f.addressee_id = i.actor and f.state = 'accepted'
  ), friend_profiles as materialized (
    select p.*, lower(coalesce(p.display_name, p.username, '')) sort_name
    from friend_ids f
    join public.profiles p on p.id = f.id and p.suspended_at is null
    cross join input i
    where not exists (
      select 1 from public.blocks b
      where (b.blocker_id = i.actor and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = i.actor)
    )
      and (
        i.cursor_name is null
        or (lower(coalesce(p.display_name, p.username, '')), p.id) > (i.cursor_name, i.cursor_id)
      )
    order by sort_name, p.id
    limit (select lim from input)
  ), direct_conversations as (
    select distinct on (peer.profile_id)
      peer.profile_id friend_id,
      c.id conversation_id
    from input i
    join public.conversation_members mine
      on mine.profile_id = i.actor and mine.left_at is null
    join public.conversations c
      on c.id = mine.conversation_id and c.kind = 'direct'
    join public.conversation_members peer
      on peer.conversation_id = c.id
     and peer.profile_id <> i.actor
     and peer.left_at is null
    join friend_profiles fp on fp.id = peer.profile_id
    order by peer.profile_id,
      coalesce(c.last_message_at, c.updated_at, c.created_at) desc,
      c.id desc
  ), actor_places as materialized (
    select distinct s.location_id
    from public.user_content_states s, input i
    where s.profile_id = i.actor
      and s.location_id is not null
      and s.state in ('saved', 'interested')
  ), common_counts as (
    select fp.id friend_id, count(distinct theirs.location_id)::bigint places_in_common
    from friend_profiles fp
    join public.user_content_states theirs
      on theirs.profile_id = fp.id
     and theirs.state in ('saved', 'interested')
     and theirs.location_id is not null
    join actor_places mine on mine.location_id = theirs.location_id
    group by fp.id
  )
  select fp.id, fp.display_name, fp.username, fp.city, fp.bio, fp.avatar_path,
    dc.conversation_id,
    coalesce(cc.places_in_common, 0),
    fp.sort_name
  from friend_profiles fp
  left join direct_conversations dc on dc.friend_id = fp.id
  left join common_counts cc on cc.friend_id = fp.id
  order by fp.sort_name, fp.id;
$$;

-- ---------------------------------------------------------------------------
-- Denormalized conversation summaries + keyset pagination.
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column if not exists last_message_id bigint references public.messages(id) on delete set null,
  add column if not exists last_message_body text,
  add column if not exists last_message_type text,
  add column if not exists last_message_at timestamptz;

alter table public.conversation_members
  add column if not exists unread_count bigint not null default 0;

with latest as (
  select distinct on (m.conversation_id)
    m.conversation_id, m.id, m.body, m.message_type, m.created_at
  from public.messages m
  where m.deleted_at is null
  order by m.conversation_id, m.id desc
)
update public.conversations c
set last_message_id = latest.id,
    last_message_body = latest.body,
    last_message_type = latest.message_type,
    last_message_at = latest.created_at
from latest
where c.id = latest.conversation_id
  and c.last_message_id is distinct from latest.id;

with unread as (
  select cm.conversation_id, cm.profile_id, count(m.id)::bigint unread_count
  from public.conversation_members cm
  left join public.messages m
    on m.conversation_id = cm.conversation_id
   and m.sender_id <> cm.profile_id
   and m.deleted_at is null
   and m.id > coalesce(cm.last_read_message_id, 0)
  where cm.left_at is null
  group by cm.conversation_id, cm.profile_id
)
update public.conversation_members cm
set unread_count = unread.unread_count
from unread
where cm.conversation_id = unread.conversation_id
  and cm.profile_id = unread.profile_id
  and cm.unread_count is distinct from unread.unread_count;

create index if not exists conversations_last_message_at_idx
  on public.conversations(last_message_at desc, id desc)
  where kind = 'direct';

create or replace function public.sync_conversation_message_summary_v2()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.conversations
    set last_message_id = new.id,
        last_message_body = new.body,
        last_message_type = new.message_type,
        last_message_at = new.created_at,
        updated_at = greatest(coalesce(updated_at, new.created_at), new.created_at)
    where id = new.conversation_id;

    update public.conversation_members
    set unread_count = unread_count + 1
    where conversation_id = new.conversation_id
      and profile_id <> new.sender_id
      and left_at is null;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.deleted_at is null and new.deleted_at is not null then
      update public.conversations c
      set (last_message_id, last_message_body, last_message_type, last_message_at) = (
        select m.id, m.body, m.message_type, m.created_at
        from public.messages m
        where m.conversation_id = new.conversation_id and m.deleted_at is null
        order by m.id desc
        limit 1
      )
      where c.id = new.conversation_id and c.last_message_id = new.id;
    elsif new.deleted_at is null then
      update public.conversations
      set last_message_body = new.body,
          last_message_type = new.message_type,
          last_message_at = new.created_at
      where id = new.conversation_id and last_message_id = new.id;
    end if;
    return new;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists messages_conversation_summary_v2 on public.messages;
create trigger messages_conversation_summary_v2
after insert or update of body, message_type, deleted_at on public.messages
for each row execute function public.sync_conversation_message_summary_v2();

create or replace function public.social_conversations_v2(
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
  unread_count bigint,
  sort_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select auth.uid() actor,
      before_sort_at cursor_at,
      before_conversation_id cursor_id,
      greatest(1, least(coalesce(result_limit, 30), 100)) lim
  ), direct as materialized (
    select c.id conversation_id,
      peer.profile_id friend_id,
      c.last_message_body,
      c.last_message_type,
      c.last_message_at,
      mine.unread_count,
      coalesce(c.last_message_at, c.updated_at, c.created_at) sort_at,
      c.pass_initiated_by
    from input i
    join public.conversation_members mine
      on mine.profile_id = i.actor and mine.left_at is null
    join public.conversations c
      on c.id = mine.conversation_id and c.kind = 'direct'
    join public.conversation_members peer
      on peer.conversation_id = c.id
     and peer.profile_id <> i.actor
     and peer.left_at is null
    where (
      i.cursor_at is null
      or (coalesce(c.last_message_at, c.updated_at, c.created_at), c.id) < (i.cursor_at, i.cursor_id)
    )
    order by sort_at desc, c.id desc
    limit (select lim * 3 from input)
  )
  select d.conversation_id, p.id, p.display_name, p.username, p.avatar_path,
    d.last_message_body, d.last_message_type, d.last_message_at,
    d.unread_count, d.sort_at
  from direct d
  join input i on true
  join public.profiles p on p.id = d.friend_id and p.suspended_at is null
  where not exists (
    select 1 from public.blocks b
    where (b.blocker_id = i.actor and b.blocked_id = p.id)
       or (b.blocker_id = p.id and b.blocked_id = i.actor)
  )
    and (
      d.pass_initiated_by is not null
      or exists (
        select 1 from public.friendships f
        where f.state = 'accepted'
          and ((f.requester_id = i.actor and f.addressee_id = p.id)
            or (f.requester_id = p.id and f.addressee_id = i.actor))
      )
    )
  order by d.sort_at desc, d.conversation_id desc
  limit (select lim from input);
$$;

create or replace function public.social_messages_v2(
  target uuid,
  before_message_id bigint default null,
  result_limit integer default 50
)
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
declare page_limit integer := greatest(1, least(coalesce(result_limit, 50), 100));
begin
  if public.social_conversation_peer_v2(target) is null then
    raise exception 'Conversation unavailable.';
  end if;

  return query
  select page.id, page.sender_id, page.sender_name, page.sender_avatar_path,
    page.body, page.message_type, page.metadata, page.edited_at, page.created_at,
    page.location_id, page.location_name, page.location_city, page.location_slug, page.location_cover_path
  from (
    select m.id, m.sender_id,
      coalesce(p.display_name, p.username, 'Someone') sender_name,
      p.avatar_path sender_avatar_path,
      m.body, m.message_type, m.metadata, m.edited_at, m.created_at,
      l.id location_id, l.name location_name, l.city location_city,
      l.slug location_slug, l.cover_path location_cover_path
    from public.messages m
    join public.profiles p on p.id = m.sender_id
    left join public.locations l
      on m.message_type = 'location'
     and coalesce(m.metadata->>'locationId', '') ~* '^[0-9a-f-]{36}$'
     and l.id = (m.metadata->>'locationId')::uuid
     and l.status = 'published'
    where m.conversation_id = target
      and m.deleted_at is null
      and (before_message_id is null or m.id < before_message_id)
    order by m.id desc
    limit page_limit
  ) page
  order by page.id asc;
end;
$$;

create or replace function public.social_mark_conversation_read_v1(target uuid, last_message bigint default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversation_members
  set last_read_message_id = coalesce(
        last_message,
        (select c.last_message_id from public.conversations c where c.id = target),
        last_read_message_id
      ),
      unread_count = 0
  where conversation_id = target
    and profile_id = auth.uid()
    and left_at is null;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bounded PASS location savers.
-- ---------------------------------------------------------------------------
create or replace function public.pass_location_savers_v2(
  target_location uuid,
  before_saved_at timestamptz default null,
  before_profile_id uuid default null,
  result_limit integer default 50
)
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
  page_limit integer := greatest(1, least(coalesce(result_limit, 50), 100));
begin
  if actor is null or not public.puddle_tinder_active_v1(actor) then
    raise exception 'Puddle Pass required.';
  end if;

  select exists (
    select 1 from public.locations location
    where location.id = target_location
      and (
        location.created_by = actor
        or (location.host_profile_id is not null and public.has_host_role(location.host_profile_id, array['owner','editor']))
        or public.is_admin()
      )
  ) into allowed;
  if not allowed then raise exception 'Location unavailable.'; end if;

  return query
  select p.id, p.display_name, p.username, p.avatar_path, s.created_at
  from public.user_content_states s
  join public.profiles p on p.id = s.profile_id
  where s.location_id = target_location
    and s.state = 'saved'
    and p.suspended_at is null
    and coalesce(p.profile_visibility, 'public') <> 'hidden'
    and (before_saved_at is null or (s.created_at, s.profile_id) < (before_saved_at, before_profile_id))
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = actor and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = actor)
    )
  order by s.created_at desc, s.profile_id desc
  limit page_limit;
end;
$$;

create or replace function public.pass_location_saver_count_v2(target_location uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  allowed boolean := false;
  result bigint := 0;
begin
  if actor is null or not public.puddle_tinder_active_v1(actor) then
    raise exception 'Puddle Pass required.';
  end if;
  select exists (
    select 1 from public.locations location
    where location.id = target_location
      and (
        location.created_by = actor
        or (location.host_profile_id is not null and public.has_host_role(location.host_profile_id, array['owner','editor']))
        or public.is_admin()
      )
  ) into allowed;
  if not allowed then raise exception 'Location unavailable.'; end if;

  select count(*)::bigint into result
  from public.user_content_states s
  join public.profiles p on p.id = s.profile_id and p.suspended_at is null
  where s.location_id = target_location and s.state = 'saved';
  return result;
end;
$$;

-- Keep legacy saver callers bounded even before every consumer migrates.
create or replace function public.pass_location_savers_v1(target_location uuid)
returns table(
  id uuid,
  display_name text,
  username text,
  avatar_path text,
  saved_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.pass_location_savers_v2(target_location, null, null, 50)
$$;

-- ---------------------------------------------------------------------------
-- Incremental Web-Mercator PASS heatmap. Runtime queries touch only visible tiles.
-- ---------------------------------------------------------------------------
create table if not exists public.location_save_density_tiles (
  zoom_level smallint not null check (zoom_level in (4, 6, 8, 10, 12, 14)),
  tile_x integer not null,
  tile_y integer not null,
  save_count bigint not null check (save_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (zoom_level, tile_x, tile_y)
);

revoke all on table public.location_save_density_tiles from public, anon, authenticated;

create or replace function public.web_mercator_tile_x_v1(lon double precision, zoom_level integer)
returns integer
language sql
immutable
strict
as $$
  select least(
    power(2.0, zoom_level)::integer - 1,
    greatest(
      0,
      floor((least(179.999999999, greatest(-180.0, lon)) + 180.0) / 360.0 * power(2.0, zoom_level))::integer
    )
  )
$$;

create or replace function public.web_mercator_tile_y_v1(lat double precision, zoom_level integer)
returns integer
language sql
immutable
strict
as $$
  select least(
    power(2.0, zoom_level)::integer - 1,
    greatest(
      0,
      floor(
        (1.0 - ln(
          tan(radians(least(85.05112878, greatest(-85.05112878, lat))))
          + 1.0 / cos(radians(least(85.05112878, greatest(-85.05112878, lat))))
        ) / pi()) / 2.0 * power(2.0, zoom_level)
      )::integer
    )
  )
$$;

create or replace function public.web_mercator_tile_lon_v1(tile_x integer, zoom_level integer)
returns double precision
language sql
immutable
strict
as $$
  select ((tile_x::double precision + 0.5) / power(2.0, zoom_level) * 360.0) - 180.0
$$;

create or replace function public.web_mercator_tile_lat_v1(tile_y integer, zoom_level integer)
returns double precision
language sql
immutable
strict
as $$
  with n as (
    select pi() - 2.0 * pi() * (tile_y::double precision + 0.5) / power(2.0, zoom_level) value
  )
  select degrees(atan((exp(value) - exp(-value)) / 2.0)) from n
$$;

create or replace function public.adjust_location_save_density_v1(
  latitude double precision,
  longitude double precision,
  delta bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare z integer; tx integer; ty integer;
begin
  if latitude is null or longitude is null or delta = 0 then return; end if;
  foreach z in array array[4, 6, 8, 10, 12, 14] loop
    tx := public.web_mercator_tile_x_v1(longitude, z);
    ty := public.web_mercator_tile_y_v1(latitude, z);
    insert into public.location_save_density_tiles(zoom_level, tile_x, tile_y, save_count, updated_at)
    values(z, tx, ty, greatest(delta, 0), now())
    on conflict (zoom_level, tile_x, tile_y) do update
      set save_count = greatest(0, public.location_save_density_tiles.save_count + delta),
          updated_at = now();
    delete from public.location_save_density_tiles
    where zoom_level = z and tile_x = tx and tile_y = ty and save_count <= 0;
  end loop;
end;
$$;

truncate table public.location_save_density_tiles;
with location_saves as (
  select l.id, l.latitude, l.longitude, count(distinct s.profile_id)::bigint save_count
  from public.user_content_states s
  join public.locations l on l.id = s.location_id
  join public.profiles p on p.id = s.profile_id and p.suspended_at is null
  where s.state = 'saved'
    and l.status = 'published'
    and l.visibility = 'public'
    and not coalesce(l.has_private_address, false)
    and l.latitude is not null
    and l.longitude is not null
  group by l.id, l.latitude, l.longitude
), zooms as (
  select unnest(array[4, 6, 8, 10, 12, 14])::integer zoom_level
)
insert into public.location_save_density_tiles(zoom_level, tile_x, tile_y, save_count)
select z.zoom_level,
  public.web_mercator_tile_x_v1(ls.longitude, z.zoom_level),
  public.web_mercator_tile_y_v1(ls.latitude, z.zoom_level),
  sum(ls.save_count)::bigint
from location_saves ls
cross join zooms z
group by z.zoom_level,
  public.web_mercator_tile_x_v1(ls.longitude, z.zoom_level),
  public.web_mercator_tile_y_v1(ls.latitude, z.zoom_level);

create or replace function public.sync_location_save_density_state_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare lat double precision; lon double precision;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.state = 'saved' and old.location_id is not null then
    select l.latitude, l.longitude into lat, lon
    from public.locations l
    join public.profiles p on p.id = old.profile_id and p.suspended_at is null
    where l.id = old.location_id
      and l.status = 'published' and l.visibility = 'public'
      and not coalesce(l.has_private_address, false)
      and l.latitude is not null and l.longitude is not null;
    if found then perform public.adjust_location_save_density_v1(lat, lon, -1); end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.state = 'saved' and new.location_id is not null then
    select l.latitude, l.longitude into lat, lon
    from public.locations l
    join public.profiles p on p.id = new.profile_id and p.suspended_at is null
    where l.id = new.location_id
      and l.status = 'published' and l.visibility = 'public'
      and not coalesce(l.has_private_address, false)
      and l.latitude is not null and l.longitude is not null;
    if found then perform public.adjust_location_save_density_v1(lat, lon, 1); end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists user_content_states_density_v1 on public.user_content_states;
create trigger user_content_states_density_v1
after insert or update of state, location_id, profile_id or delete on public.user_content_states
for each row execute function public.sync_location_save_density_state_v1();

create or replace function public.sync_location_save_density_location_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare saver_count bigint := 0;
declare old_eligible boolean := false;
declare new_eligible boolean := false;
begin
  if old.latitude is not distinct from new.latitude
    and old.longitude is not distinct from new.longitude
    and old.status is not distinct from new.status
    and old.visibility is not distinct from new.visibility
    and old.has_private_address is not distinct from new.has_private_address then
    return new;
  end if;

  select count(distinct s.profile_id)::bigint into saver_count
  from public.user_content_states s
  join public.profiles p on p.id = s.profile_id and p.suspended_at is null
  where s.location_id = new.id and s.state = 'saved';

  old_eligible := old.status = 'published' and old.visibility = 'public'
    and not coalesce(old.has_private_address, false)
    and old.latitude is not null and old.longitude is not null;
  new_eligible := new.status = 'published' and new.visibility = 'public'
    and not coalesce(new.has_private_address, false)
    and new.latitude is not null and new.longitude is not null;

  if saver_count > 0 and old_eligible then
    perform public.adjust_location_save_density_v1(old.latitude, old.longitude, -saver_count);
  end if;
  if saver_count > 0 and new_eligible then
    perform public.adjust_location_save_density_v1(new.latitude, new.longitude, saver_count);
  end if;
  return new;
end;
$$;

drop trigger if exists locations_density_v1 on public.locations;
create trigger locations_density_v1
after update of latitude, longitude, status, visibility, has_private_address on public.locations
for each row execute function public.sync_location_save_density_location_v1();

create or replace function public.sync_location_save_density_profile_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare row record; delta bigint;
begin
  if (old.suspended_at is null) = (new.suspended_at is null) then return new; end if;
  delta := case when new.suspended_at is null then 1 else -1 end;
  for row in
    select l.latitude, l.longitude
    from public.user_content_states s
    join public.locations l on l.id = s.location_id
    where s.profile_id = new.id and s.state = 'saved'
      and l.status = 'published' and l.visibility = 'public'
      and not coalesce(l.has_private_address, false)
      and l.latitude is not null and l.longitude is not null
  loop
    perform public.adjust_location_save_density_v1(row.latitude, row.longitude, delta);
  end loop;
  return new;
end;
$$;

drop trigger if exists profiles_density_v1 on public.profiles;
create trigger profiles_density_v1
after update of suspended_at on public.profiles
for each row execute function public.sync_location_save_density_profile_v1();

create or replace function public.pass_location_heatmap_viewport_v2(
  north double precision,
  south double precision,
  east double precision,
  west double precision,
  map_zoom double precision,
  result_limit integer default 250
)
returns table(
  tile_id text,
  name text,
  latitude double precision,
  longitude double precision,
  save_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  z integer;
  north_y integer;
  south_y integer;
  west_x integer;
  east_x integer;
  page_limit integer := greatest(1, least(coalesce(result_limit, 250), 500));
begin
  if auth.uid() is null or not public.puddle_tinder_active_v1(auth.uid()) then
    raise exception 'Puddle Pass required.';
  end if;
  if north is null or south is null or east is null or west is null then
    return;
  end if;

  z := case
    when coalesce(map_zoom, 10) <= 5 then 4
    when map_zoom <= 7 then 6
    when map_zoom <= 9 then 8
    when map_zoom <= 11 then 10
    when map_zoom <= 13 then 12
    else 14 end;

  north_y := public.web_mercator_tile_y_v1(greatest(north, south), z);
  south_y := public.web_mercator_tile_y_v1(least(north, south), z);
  west_x := public.web_mercator_tile_x_v1(west, z);
  east_x := public.web_mercator_tile_x_v1(east, z);

  return query
  select format('%s/%s/%s', t.zoom_level, t.tile_x, t.tile_y),
    'Popular area'::text,
    public.web_mercator_tile_lat_v1(t.tile_y, t.zoom_level),
    public.web_mercator_tile_lon_v1(t.tile_x, t.zoom_level),
    t.save_count
  from public.location_save_density_tiles t
  where t.zoom_level = z
    and t.tile_y between north_y and south_y
    and (
      (west <= east and t.tile_x between west_x and east_x)
      or (west > east and (t.tile_x >= west_x or t.tile_x <= east_x))
    )
    and t.save_count > 0
  order by t.save_count desc, t.tile_x, t.tile_y
  limit page_limit;
end;
$$;

-- Make the legacy heatmap cheap as well: it reads pre-aggregated zoom-6 cells.
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
  select (
      substr(md5(format('%s/%s/%s', t.zoom_level, t.tile_x, t.tile_y)), 1, 8) || '-' ||
      substr(md5(format('%s/%s/%s', t.zoom_level, t.tile_x, t.tile_y)), 9, 4) || '-' ||
      substr(md5(format('%s/%s/%s', t.zoom_level, t.tile_x, t.tile_y)), 13, 4) || '-' ||
      substr(md5(format('%s/%s/%s', t.zoom_level, t.tile_x, t.tile_y)), 17, 4) || '-' ||
      substr(md5(format('%s/%s/%s', t.zoom_level, t.tile_x, t.tile_y)), 21, 12)
    )::uuid,
    'Popular area'::text,
    public.web_mercator_tile_lat_v1(t.tile_y, t.zoom_level),
    public.web_mercator_tile_lon_v1(t.tile_x, t.zoom_level),
    t.save_count
  from public.location_save_density_tiles t
  where public.puddle_tinder_active_v1(auth.uid()) and t.zoom_level = 6 and t.save_count > 0
  order by t.save_count desc
  limit 500
$$;

-- ---------------------------------------------------------------------------
-- Bounded feed comment previews. Posts themselves are cursor-paged in app code.
-- ---------------------------------------------------------------------------
create or replace function public.social_comment_previews_v2(
  post_ids uuid[],
  per_post integer default 3
)
returns table(
  id bigint,
  post_id uuid,
  author_id uuid,
  body text,
  created_at timestamptz,
  display_name text,
  username text,
  avatar_path text
)
language sql
stable
security invoker
set search_path = public
as $$
  with ranked as (
    select c.id, c.post_id, c.author_id, c.body, c.created_at,
      row_number() over (partition by c.post_id order by c.created_at desc, c.id desc) rn
    from public.social_comments c
    where c.post_id = any(coalesce(post_ids, array[]::uuid[]))
      and c.deleted_at is null
  )
  select r.id, r.post_id, r.author_id, r.body, r.created_at,
    p.display_name, p.username, p.avatar_path
  from ranked r
  join public.profiles p on p.id = r.author_id
  where r.rn <= greatest(1, least(coalesce(per_post, 3), 5))
  order by r.post_id, r.created_at asc, r.id asc
$$;

-- New RPCs are authenticated-only.
revoke all on function public.social_friend_search_v2(text, integer) from public, anon;
revoke all on function public.pass_message_search_v2(text, integer) from public, anon;
revoke all on function public.social_friends_v2(text, uuid, integer) from public, anon;
revoke all on function public.social_conversations_v2(timestamptz, uuid, integer) from public, anon;
revoke all on function public.social_messages_v2(uuid, bigint, integer) from public, anon;
revoke all on function public.pass_location_savers_v2(uuid, timestamptz, uuid, integer) from public, anon;
revoke all on function public.pass_location_saver_count_v2(uuid) from public, anon;
revoke all on function public.pass_location_heatmap_viewport_v2(double precision, double precision, double precision, double precision, double precision, integer) from public, anon;
revoke all on function public.social_comment_previews_v2(uuid[], integer) from public, anon;
revoke all on function public.adjust_location_save_density_v1(double precision, double precision, bigint) from public, anon, authenticated;

 grant execute on function public.social_friend_search_v2(text, integer) to authenticated;
 grant execute on function public.pass_message_search_v2(text, integer) to authenticated;
 grant execute on function public.social_friends_v2(text, uuid, integer) to authenticated;
 grant execute on function public.social_conversations_v2(timestamptz, uuid, integer) to authenticated;
 grant execute on function public.social_messages_v2(uuid, bigint, integer) to authenticated;
 grant execute on function public.pass_location_savers_v2(uuid, timestamptz, uuid, integer) to authenticated;
 grant execute on function public.pass_location_saver_count_v2(uuid) to authenticated;
 grant execute on function public.pass_location_heatmap_viewport_v2(double precision, double precision, double precision, double precision, double precision, integer) to authenticated;
 grant execute on function public.social_comment_previews_v2(uuid[], integer) to authenticated;
