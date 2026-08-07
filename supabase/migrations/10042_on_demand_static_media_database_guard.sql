-- Keep on-demand coordination rows from consuming the final database headroom.
-- The launch ceiling remains 400,000,000 bytes; resolution claims stop 10 MB
-- earlier so one accepted request cannot push metadata writes over that ceiling.

create or replace function public.guard_static_media_resolution_database_size_v1()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if pg_database_size(current_database()) >= 390000000 then
    raise exception 'static media resolution database safety margin reached';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_static_media_resolution_database_size_v1() from public,anon,authenticated;

drop trigger if exists static_media_resolution_database_size_guard
  on public.static_media_resolution_states;
create trigger static_media_resolution_database_size_guard
before insert on public.static_media_resolution_states
for each row execute function public.guard_static_media_resolution_database_size_v1();

comment on function public.guard_static_media_resolution_database_size_v1() is
  'Rejects new on-demand resolution state rows at 390 MB, preserving headroom below the immutable 400 MB launch ceiling.';