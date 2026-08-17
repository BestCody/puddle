-- Exact keyset cursor for the social feed. RLS remains authoritative because this
-- function is SECURITY INVOKER; it only chooses the bounded post IDs to hydrate.

create or replace function public.social_feed_post_ids_v2(
  before_created_at timestamptz default null,
  before_post_id uuid default null,
  result_limit integer default 26
)
returns table(id uuid, created_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id, p.created_at
  from public.social_posts p
  where before_created_at is null
     or (p.created_at, p.id) < (before_created_at, before_post_id)
  order by p.created_at desc, p.id desc
  limit greatest(1, least(coalesce(result_limit, 26), 51))
$$;

revoke all on function public.social_feed_post_ids_v2(timestamptz,uuid,integer) from public,anon;
grant execute on function public.social_feed_post_ids_v2(timestamptz,uuid,integer) to authenticated;
