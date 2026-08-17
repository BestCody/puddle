-- Ensure bounded responses are also bounded database work on viral/high-cardinality rows.

-- Per-location save totals are maintained incrementally so studio pages never COUNT
-- an arbitrarily large saver set just to render the headline.
create table if not exists public.location_save_counts (
  location_id uuid primary key references public.locations(id) on delete cascade,
  save_count bigint not null check (save_count >= 0),
  updated_at timestamptz not null default now()
);

revoke all on table public.location_save_counts from public, anon, authenticated;

insert into public.location_save_counts(location_id, save_count, updated_at)
select s.location_id, count(*)::bigint, now()
from public.user_content_states s
where s.location_id is not null and s.state = 'saved'
group by s.location_id
on conflict (location_id) do update
set save_count = excluded.save_count,
    updated_at = excluded.updated_at;

create or replace function public.adjust_location_save_count_v1(target_location uuid, delta bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_location is null or delta = 0 then return; end if;

  insert into public.location_save_counts(location_id, save_count, updated_at)
  values(target_location, greatest(delta, 0), now())
  on conflict (location_id) do update
  set save_count = greatest(0, public.location_save_counts.save_count + delta),
      updated_at = now();

  delete from public.location_save_counts
  where location_id = target_location and save_count <= 0;
end;
$$;

-- Replace the existing saved-state trigger body so one state transition updates both
-- the O(1) location total and the pre-aggregated map density pyramid.
create or replace function public.sync_location_save_density_state_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lat double precision;
  lon double precision;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.state = 'saved' and old.location_id is not null then
    perform public.adjust_location_save_count_v1(old.location_id, -1);

    select l.latitude, l.longitude into lat, lon
    from public.locations l
    join public.profiles p on p.id = old.profile_id and p.suspended_at is null
    where l.id = old.location_id
      and l.status = 'published'
      and l.visibility = 'public'
      and not coalesce(l.has_private_address, false)
      and l.latitude is not null
      and l.longitude is not null;
    if found then perform public.adjust_location_save_density_v1(lat, lon, -1); end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.state = 'saved' and new.location_id is not null then
    perform public.adjust_location_save_count_v1(new.location_id, 1);

    select l.latitude, l.longitude into lat, lon
    from public.locations l
    join public.profiles p on p.id = new.profile_id and p.suspended_at is null
    where l.id = new.location_id
      and l.status = 'published'
      and l.visibility = 'public'
      and not coalesce(l.has_private_address, false)
      and l.latitude is not null
      and l.longitude is not null;
    if found then perform public.adjust_location_save_density_v1(lat, lon, 1); end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
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

  select coalesce(c.save_count, 0)
  into result
  from public.location_save_counts c
  where c.location_id = target_location;

  return coalesce(result, 0);
end;
$$;

-- Top-N comment previews use one indexed seek per requested post. The old windowed
-- implementation bounded output but could still rank every comment on a viral post.
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
  with requested as (
    select distinct requested_post_id
    from unnest(coalesce(post_ids, array[]::uuid[])) requested_post_id
    limit 40
  )
  select c.id, c.post_id, c.author_id, c.body, c.created_at,
    p.display_name, p.username, p.avatar_path
  from requested r
  cross join lateral (
    select comment.id, comment.post_id, comment.author_id, comment.body, comment.created_at
    from public.social_comments comment
    where comment.post_id = r.requested_post_id
      and comment.deleted_at is null
    order by comment.created_at desc, comment.id desc
    limit greatest(1, least(coalesce(per_post, 3), 5))
  ) c
  join public.profiles p on p.id = c.author_id
  order by c.post_id, c.created_at asc, c.id asc
$$;

-- Correct the last-message summary when the final live message is soft-deleted.
create or replace function public.sync_conversation_message_summary_v2()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  latest_id bigint;
  latest_body text;
  latest_type text;
  latest_at timestamptz;
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

  if old.deleted_at is null and new.deleted_at is not null then
    update public.conversation_members
    set unread_count = greatest(0, unread_count - 1)
    where conversation_id = new.conversation_id
      and profile_id <> new.sender_id
      and left_at is null
      and new.id > coalesce(last_read_message_id, 0);

    if exists (
      select 1 from public.conversations c
      where c.id = new.conversation_id and c.last_message_id = new.id
    ) then
      select m.id, m.body, m.message_type, m.created_at
      into latest_id, latest_body, latest_type, latest_at
      from public.messages m
      where m.conversation_id = new.conversation_id
        and m.deleted_at is null
      order by m.id desc
      limit 1;

      update public.conversations
      set last_message_id = latest_id,
          last_message_body = latest_body,
          last_message_type = latest_type,
          last_message_at = latest_at
      where id = new.conversation_id;
    end if;
  elsif new.deleted_at is null then
    update public.conversations
    set last_message_body = new.body,
        last_message_type = new.message_type,
        last_message_at = new.created_at
    where id = new.conversation_id and last_message_id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.adjust_location_save_count_v1(uuid,bigint) from public,anon,authenticated;
