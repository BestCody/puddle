-- Complete the dashboard features that are already represented in the UI.
-- This migration adds first-class social posts, makes saved places pinnable,
-- persists appearance/profile theme choices, extends social comments/shares to
-- posts, enables location attachments in direct messages, and keeps
-- notifications in-app after the legacy delivery outbox was removed.

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  body text not null default '' check (char_length(body) <= 1000),
  visibility text not null default 'public' check (visibility in ('public','friends')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists social_posts_feed_idx
  on public.social_posts(created_at desc);
create index if not exists social_posts_author_idx
  on public.social_posts(author_id, created_at desc);
create index if not exists social_posts_location_idx
  on public.social_posts(location_id, created_at desc);

alter table public.social_posts enable row level security;

grant select, insert, update, delete on table public.social_posts to authenticated;
revoke all on table public.social_posts from anon;

drop policy if exists "social posts visible to allowed viewers" on public.social_posts;
create policy "social posts visible to allowed viewers"
on public.social_posts for select
to authenticated
using (
  author_id = (select auth.uid())
  or visibility = 'public'
  or (
    visibility = 'friends'
    and public.profiles_are_friends((select auth.uid()), author_id)
  )
);

drop policy if exists "users create own social posts" on public.social_posts;
create policy "users create own social posts"
on public.social_posts for insert
to authenticated
with check (author_id = (select auth.uid()));

drop policy if exists "users update own social posts" on public.social_posts;
create policy "users update own social posts"
on public.social_posts for update
to authenticated
using (author_id = (select auth.uid()))
with check (author_id = (select auth.uid()));

drop policy if exists "users delete own social posts" on public.social_posts;
create policy "users delete own social posts"
on public.social_posts for delete
to authenticated
using (author_id = (select auth.uid()));

alter table public.social_comments
  add column if not exists post_id uuid references public.social_posts(id) on delete cascade;

alter table public.social_comments drop constraint if exists social_comments_check;
alter table public.social_comments
  add constraint social_comments_check
  check (num_nonnulls(event_id, location_id, post_id) = 1);

create index if not exists social_comments_post_idx
  on public.social_comments(post_id, created_at)
  where post_id is not null;

alter table public.content_shares
  add column if not exists post_id uuid references public.social_posts(id) on delete cascade;

alter table public.content_shares drop constraint if exists content_shares_check1;
alter table public.content_shares
  add constraint content_shares_check1
  check (num_nonnulls(event_id, location_id, post_id) = 1);

create index if not exists content_shares_post_idx
  on public.content_shares(post_id, created_at desc)
  where post_id is not null;

alter table public.user_content_states
  add column if not exists pinned_at timestamptz;

alter table public.profiles
  add column if not exists profile_theme text not null default 'blue';
alter table public.profiles
  add column if not exists appearance_theme text not null default 'light';

alter table public.profiles drop constraint if exists profiles_profile_theme_check;
alter table public.profiles
  add constraint profiles_profile_theme_check
  check (profile_theme in ('red','yellow','green','blue','grey','purple'));

alter table public.profiles drop constraint if exists profiles_appearance_theme_check;
alter table public.profiles
  add constraint profiles_appearance_theme_check
  check (appearance_theme in ('light','dark','system'));

create or replace function public.create_social_comment_v1(
  target_kind text,
  target_id uuid,
  comment_body text,
  parent_comment bigint default null
)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare
  cid bigint;
  target_author uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if target_kind not in ('event','place','post') then raise exception 'Comment target is invalid.'; end if;
  if nullif(trim(comment_body),'') is null then raise exception 'comment required'; end if;

  if target_kind='post' and not exists (
    select 1 from public.social_posts p
    where p.id=target_id
      and (
        p.author_id=auth.uid()
        or p.visibility='public'
        or (p.visibility='friends' and public.profiles_are_friends(auth.uid(),p.author_id))
      )
  ) then raise exception 'Post unavailable.'; end if;

  if parent_comment is not null and not exists (
    select 1 from public.social_comments
    where id=parent_comment and parent_id is null
      and (
        (target_kind='event' and event_id=target_id)
        or (target_kind='place' and location_id=target_id)
        or (target_kind='post' and post_id=target_id)
      )
  ) then raise exception 'reply unavailable'; end if;

  insert into public.social_comments(author_id,event_id,location_id,post_id,parent_id,body)
  values(
    auth.uid(),
    case when target_kind='event' then target_id end,
    case when target_kind='place' then target_id end,
    case when target_kind='post' then target_id end,
    parent_comment,
    left(trim(comment_body),2000)
  ) returning id into cid;

  if target_kind='post' then
    select author_id into target_author from public.social_posts where id=target_id;
    if target_author is not null and target_author <> auth.uid() then
      perform public.queue_notification_v1(
        target_author,
        auth.uid(),
        'comment',
        'New comment',
        'Someone commented on your puddle.',
        '/map',
        jsonb_build_object('postId',target_id,'commentId',cid)
      );
    end if;
  end if;

  return cid;
end;
$$;

revoke all on function public.create_social_comment_v1(text,uuid,text,bigint) from public,anon;
grant execute on function public.create_social_comment_v1(text,uuid,text,bigint) to authenticated;

create or replace function public.share_content_v1(
  target_kind text,
  target_id uuid,
  recipient_profile uuid default null,
  target_plan uuid default null,
  share_note text default null
)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare sid bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if target_kind not in ('event','place','post') then raise exception 'Share target is invalid.'; end if;
  if num_nonnulls(recipient_profile,target_plan)<>1 then raise exception 'destination required';end if;
  if recipient_profile is not null and not public.profiles_are_friends(auth.uid(),recipient_profile) then raise exception 'friend unavailable';end if;
  if target_plan is not null and not public.can_edit_plan(target_plan) then raise exception 'plan unavailable';end if;
  if target_kind='post' and not exists (
    select 1 from public.social_posts p
    where p.id=target_id
      and (p.author_id=auth.uid() or p.visibility='public' or (p.visibility='friends' and public.profiles_are_friends(auth.uid(),p.author_id)))
  ) then raise exception 'Post unavailable.'; end if;

  insert into public.content_shares(sender_id,recipient_id,plan_id,event_id,location_id,post_id,note)
  values(
    auth.uid(),recipient_profile,target_plan,
    case when target_kind='event' then target_id end,
    case when target_kind='place' then target_id end,
    case when target_kind='post' then target_id end,
    left(share_note,1000)
  ) returning id into sid;

  if recipient_profile is not null then
    perform public.queue_notification_v1(
      recipient_profile,
      auth.uid(),
      'share',
      'Shared with you',
      'A friend shared something with you.',
      case when target_kind='post' then '/map' else '/plans' end,
      jsonb_build_object('shareId',sid,'targetKind',target_kind,'targetId',target_id)
    );
  end if;
  return sid;
end;
$$;

revoke all on function public.share_content_v1(text,uuid,uuid,uuid,text) from public,anon;
grant execute on function public.share_content_v1(text,uuid,uuid,uuid,text) to authenticated;

create or replace function public.social_send_location_message_v1(target uuid, target_location uuid)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare mid bigint;
begin
  if public.social_conversation_friend_v1(target) is null then raise exception 'Conversation unavailable.'; end if;
  if not exists(select 1 from public.locations where id=target_location and status='published') then raise exception 'Location unavailable.'; end if;
  insert into public.messages(conversation_id,sender_id,body,message_type,metadata)
  values(target,auth.uid(),'Shared a place','location',jsonb_build_object('locationId',target_location))
  returning id into mid;
  update public.conversations set updated_at=now() where id=target;
  return mid;
end;
$$;

revoke all on function public.social_send_location_message_v1(uuid,uuid) from public,anon;
grant execute on function public.social_send_location_message_v1(uuid,uuid) to authenticated;

-- The legacy email/push outbox was intentionally removed. Keep notification
-- creation functional as an in-app channel instead of referencing a table that
-- no longer exists.
create or replace function public.queue_notification_v1(
  target_profile uuid,
  actor uuid,
  notification_kind text,
  notification_title text,
  notification_body text,
  notification_href text default null,
  notification_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare
  created bigint;
  p public.notification_preferences%rowtype;
begin
  if target_profile is null then return null; end if;
  insert into public.notification_preferences(profile_id)
  values(target_profile)
  on conflict do nothing;

  select * into p from public.notification_preferences where profile_id=target_profile;
  if p.in_app_enabled then
    insert into public.notifications(profile_id,actor_id,kind,title,body,href,metadata)
    values(
      target_profile,
      actor,
      left(notification_kind,80),
      left(notification_title,180),
      left(notification_body,1000),
      notification_href,
      coalesce(notification_metadata,'{}')
    ) returning id into created;
  end if;
  return created;
end;
$$;

revoke all on function public.queue_notification_v1(uuid,uuid,text,text,text,text,jsonb) from public,anon;
grant execute on function public.queue_notification_v1(uuid,uuid,text,text,text,text,jsonb) to authenticated;
