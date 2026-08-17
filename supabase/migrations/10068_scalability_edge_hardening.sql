-- Close edge cases in the bounded social and density paths.

-- Feed share pickers only need identity fields, not common-place/conversation metadata.
create or replace function public.social_friend_picker_v2(
  before_name text default null,
  before_id uuid default null,
  result_limit integer default 30
)
returns table(
  id uuid,
  display_name text,
  username text,
  avatar_path text,
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
      greatest(1, least(coalesce(result_limit, 30), 100)) lim
  ), friend_ids as (
    select f.addressee_id id
    from public.friendships f, input i
    where f.requester_id = i.actor and f.state = 'accepted'
    union
    select f.requester_id id
    from public.friendships f, input i
    where f.addressee_id = i.actor and f.state = 'accepted'
  )
  select p.id, p.display_name, p.username, p.avatar_path,
    lower(coalesce(p.display_name, p.username, '')) sort_name
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
$$;

-- A caller may mark only part of a conversation as read; keep the unread counter exact.
create or replace function public.social_mark_conversation_read_v1(target uuid, last_message bigint default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  next_read bigint;
  next_unread bigint := 0;
begin
  if not public.is_conversation_member(target) then
    raise exception 'Conversation unavailable.';
  end if;

  select coalesce(last_message, c.last_message_id)
  into next_read
  from public.conversations c
  where c.id = target;

  if next_read is not null and last_message is not null then
    select count(*)::bigint
    into next_unread
    from public.messages m
    where m.conversation_id = target
      and m.sender_id <> auth.uid()
      and m.deleted_at is null
      and m.id > next_read;
  end if;

  update public.conversation_members
  set last_read_message_id = coalesce(next_read, last_read_message_id),
      unread_count = next_unread
  where conversation_id = target
    and profile_id = auth.uid()
    and left_at is null;
  return found;
end;
$$;

-- Subtract aggregate density before parent deletes cascade into saved-state rows.
create or replace function public.remove_location_save_density_on_location_delete_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare saver_count bigint := 0;
begin
  if old.status = 'published'
    and old.visibility = 'public'
    and not coalesce(old.has_private_address, false)
    and old.latitude is not null
    and old.longitude is not null then
    select count(distinct s.profile_id)::bigint
    into saver_count
    from public.user_content_states s
    join public.profiles p on p.id = s.profile_id and p.suspended_at is null
    where s.location_id = old.id and s.state = 'saved';

    if saver_count > 0 then
      perform public.adjust_location_save_density_v1(old.latitude, old.longitude, -saver_count);
    end if;
  end if;
  return old;
end;
$$;

drop trigger if exists locations_density_delete_v1 on public.locations;
create trigger locations_density_delete_v1
before delete on public.locations
for each row execute function public.remove_location_save_density_on_location_delete_v1();

create or replace function public.remove_location_save_density_on_profile_delete_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare row record;
begin
  if old.suspended_at is null then
    for row in
      select l.latitude, l.longitude
      from public.user_content_states s
      join public.locations l on l.id = s.location_id
      where s.profile_id = old.id
        and s.state = 'saved'
        and l.status = 'published'
        and l.visibility = 'public'
        and not coalesce(l.has_private_address, false)
        and l.latitude is not null
        and l.longitude is not null
    loop
      perform public.adjust_location_save_density_v1(row.latitude, row.longitude, -1);
    end loop;
  end if;
  return old;
end;
$$;

drop trigger if exists profiles_density_delete_v1 on public.profiles;
create trigger profiles_density_delete_v1
before delete on public.profiles
for each row execute function public.remove_location_save_density_on_profile_delete_v1();

revoke all on function public.social_friend_picker_v2(text,uuid,integer) from public,anon;
grant execute on function public.social_friend_picker_v2(text,uuid,integer) to authenticated;
