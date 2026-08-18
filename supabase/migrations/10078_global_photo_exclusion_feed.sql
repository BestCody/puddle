-- Service-role-only feed of retired B2 photo identities. The global fingerprint
-- backfill writes these identities to a small B2 exclusion overlay so an active
-- snapshot created before the retirement stops serving/skipping the stale photo
-- immediately, without rewriting the 30M-location snapshot.

create or replace function public.list_retired_b2_photo_exclusions_v1(p_limit integer default 50000)
returns table(location_id uuid,content_hash text)
language sql
stable
security definer
set search_path=''
as $$
  select p.location_id,lower(m.content_hash)
  from public.location_photo_sources p
  join public.media_objects m on m.id=p.media_object_id
  where p.status='expired'
    and p.location_id is not null
    and lower(coalesce(p.storage_backend,''))='b2'
    and lower(coalesce(m.storage_backend,''))='b2'
    and m.content_hash ~* '^[0-9a-f]{64}$'
  order by p.updated_at desc,p.location_id,p.id
  limit greatest(1,least(coalesce(p_limit,50000),100000))
$$;

revoke all on function public.list_retired_b2_photo_exclusions_v1(integer) from public,anon,authenticated;
grant execute on function public.list_retired_b2_photo_exclusions_v1(integer) to service_role;
