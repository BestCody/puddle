begin;

-- Regional catalogue refresh state was retired when canonical location data moved
-- to B2/OpenSearch. PostgreSQL does not track table references embedded in
-- PL/pgSQL function bodies, so dropping catalogue_sync_regions did not remove
-- the profile trigger/function chain that attempted to enqueue refresh work.
drop trigger if exists profiles_queue_catalogue_region on public.profiles;
drop function if exists public.queue_profile_catalogue_region_trigger();
drop function if exists public.queue_catalogue_region_v1(uuid);
drop function if exists public.touch_catalogue_sync_region();
drop function if exists public.catalogue_radius_bucket(integer);

commit;
