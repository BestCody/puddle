create or replace function public.social_friend_count_v1()
returns bigint
language sql stable security definer set search_path = ''
as $$
  with actor as (select auth.uid() id), friend_ids as (
    select f.addressee_id id from public.friendships f,actor a
    where f.requester_id=a.id and f.state='accepted'
    union
    select f.requester_id id from public.friendships f,actor a
    where f.addressee_id=a.id and f.state='accepted'
  )
  select count(*)
  from friend_ids f
  join public.profiles p on p.id=f.id and p.suspended_at is null
  cross join actor a
  where not exists (
    select 1 from public.blocks b
    where (b.blocker_id=a.id and b.blocked_id=f.id)
       or (b.blocker_id=f.id and b.blocked_id=a.id)
  );
$$;

revoke all on function public.social_friend_count_v1() from public,anon;
grant execute on function public.social_friend_count_v1() to authenticated,service_role;
