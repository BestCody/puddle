-- Review deletion is an idempotent user mutation. A missing row means the
-- requested end state is already true and must not be surfaced as an error.

create or replace function public.delete_location_review_v1(target_location uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  delete from public.location_reviews
  where location_id = target_location
    and author_id = auth.uid();

  return true;
end;
$$;

revoke all on function public.delete_location_review_v1(uuid) from public, anon;
grant execute on function public.delete_location_review_v1(uuid) to authenticated;
