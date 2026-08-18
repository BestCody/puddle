-- B2-backed open photos are identified by media_object_id/content_hash, never a serving URL.
alter table public.location_photo_sources alter column remote_url drop not null;

update public.location_photo_sources
set remote_url = null, updated_at = now()
where lower(coalesce(storage_backend, '')) = 'b2'
  and media_object_id is not null;

update public.media_objects
set public_url = null, updated_at = now()
where lower(storage_backend) = 'b2'
  and public_url is not null;
