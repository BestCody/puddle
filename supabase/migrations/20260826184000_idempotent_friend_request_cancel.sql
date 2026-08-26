-- Cancelling an outgoing request is an idempotent user mutation. Reassert the
-- function and grant explicitly so the active social UI does not depend on
-- privilege state inherited from an older migration.

create or replace function public.social_cancel_friend_request_v1(target uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;
  if target is null or target = auth.uid() then
    raise exception 'Friend request is unavailable.';
  end if;

  update public.friendships
  set state = 'removed'
  where requester_id = auth.uid()
    and addressee_id = target
    and state = 'pending';

  return true;
end;
$$;

revoke all on function public.social_cancel_friend_request_v1(uuid) from public, anon;
grant execute on function public.social_cancel_friend_request_v1(uuid) to authenticated;
