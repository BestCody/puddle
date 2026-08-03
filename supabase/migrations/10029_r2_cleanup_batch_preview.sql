-- Dry-run aware replacement for the cleanup preparation RPC.
create or replace function public.prepare_r2_cleanup_v2(
  photo_limit integer default 500,
  location_limit integer default 500,
  apply_changes boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  safe_photo_limit integer := least(5000,greatest(1,coalesce(photo_limit,500)));
  safe_location_limit integer := least(5000,greatest(1,coalesce(location_limit,500)));
  changed_locations uuid[] := '{}'::uuid[];
  expired_count integer := 0;
  cold_count integer := 0;
  deleted_locations integer := 0;
  location_row record;
  orphan_rows jsonb;
begin
  if coalesce(auth.role()::text,'')<>'service_role' then raise exception 'service role required'; end if;

  if apply_changes then
    with targets as (
      select source.id,source.location_id
      from public.location_photo_sources source
      where source.media_object_id is not null
        and (source.status in ('rejected','archived') or source.expires_at<now())
      order by source.verified_at asc nulls first
      limit safe_photo_limit
    ), removed as (
      delete from public.location_photo_sources source
      using targets
      where source.id=targets.id
      returning targets.location_id
    )
    select coalesce(array_agg(distinct location_id),'{}'::uuid[]),count(*)
    into changed_locations,expired_count
    from removed;
  else
    select coalesce(array_agg(distinct target.location_id),'{}'::uuid[]),count(*)
    into changed_locations,expired_count
    from (
      select source.location_id
      from public.location_photo_sources source
      where source.media_object_id is not null
        and (source.status in ('rejected','archived') or source.expires_at<now())
      order by source.verified_at asc nulls first
      limit safe_photo_limit
    ) target;
  end if;

  select count(*) into cold_count
  from (
    select materialization.location_id
    from public.static_catalogue_materializations materialization
    where materialization.expires_at<now()
    order by materialization.expires_at asc
    limit safe_location_limit
  ) target;

  if apply_changes then
    for location_row in
      select materialization.location_id
      from public.static_catalogue_materializations materialization
      where materialization.expires_at<now()
      order by materialization.expires_at asc
      limit safe_location_limit
    loop
      if public.delete_cold_static_materialization_v1(location_row.location_id) then
        deleted_locations := deleted_locations+1;
      end if;
    end loop;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',media.id,
    'storageBackend',media.storage_backend,
    'storageKey',media.storage_key
  )),'[]'::jsonb)
  into orphan_rows
  from (
    select object.id,object.storage_backend,object.storage_key
    from public.media_objects object
    where not exists(
      select 1 from public.location_photo_sources source where source.media_object_id=object.id
    )
    order by object.created_at asc
    limit safe_photo_limit
  ) media;

  return jsonb_build_object(
    'mode',case when apply_changes then 'apply' else 'dry-run' end,
    'expiredPhotoRows',expired_count,
    'changedLocationIds',to_jsonb(changed_locations),
    'coldMaterializations',cold_count,
    'deletedLocations',deleted_locations,
    'orphanMedia',coalesce(orphan_rows,'[]'::jsonb)
  );
end;
$$;
revoke all on function public.prepare_r2_cleanup_v2(integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.prepare_r2_cleanup_v2(integer,integer,boolean) to service_role;
