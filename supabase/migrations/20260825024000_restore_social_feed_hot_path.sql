-- Restore the bounded social-feed helpers on production with a timestamped migration.
-- The original 10067/10069 migrations exist in source but are absent from the
-- production migration ledger, so this migration is intentionally idempotent.

create index if not exists social_posts_feed_keyset_idx
  on public.social_posts (created_at desc, id desc);

create index if not exists social_comments_post_preview_idx
  on public.social_comments (post_id, created_at desc, id desc)
  where post_id is not null and deleted_at is null;

create or replace function public.social_feed_post_ids_v2(
  before_created_at timestamptz default null,
  before_post_id uuid default null,
  result_limit integer default 26
)
returns table(id uuid, created_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.created_at
  from public.social_posts p
  where before_created_at is null
     or (p.created_at, p.id) < (before_created_at, before_post_id)
  order by p.created_at desc, p.id desc
  limit greatest(1, least(coalesce(result_limit, 26), 51))
$$;

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
set search_path = ''
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

revoke all on function public.social_feed_post_ids_v2(timestamptz,uuid,integer) from public, anon;
revoke all on function public.social_comment_previews_v2(uuid[],integer) from public, anon;
grant execute on function public.social_feed_post_ids_v2(timestamptz,uuid,integer) to authenticated, service_role;
grant execute on function public.social_comment_previews_v2(uuid[],integer) to authenticated, service_role;
