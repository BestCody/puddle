-- One-time, manifest-gated reset of the canonical global location-photo data.
-- This file is intentionally an operational SQL script, not an automatically
-- applied migration. The reset workflow runs it only after the immutable B2
-- recovery manifest has been verified.

begin;

do $$
begin
  if to_regclass('public.media_objects') is null
     or to_regclass('public.global_photo_claims') is null then
    raise exception 'canonical photo reset requires active B2 media and uniqueness tables';
  end if;
end;
$$;

create temporary table photo_reset_media_ids on commit drop as
select id
from public.media_objects
where lower(storage_backend)='b2'
  and storage_key ~ '^media/photos/by-sha256/[0-9a-f]{2}/[0-9a-f]{64}\.jpg$'
  and split_part(storage_key,'/',4)=substr(split_part(storage_key,'/',5),1,2);

-- Global registries contain no user media and are rebuilt by the corrected
-- provider/materializer pipeline. The candidate registry was introduced after
-- the initial B2 cutover, so keep this operation idempotent for a first apply.
do $$
begin
  if to_regclass('public.global_photo_candidate_registry') is not null then
    execute 'delete from public.global_photo_candidate_registry';
  end if;
end;
$$;
delete from public.global_photo_claims;

-- Static catalogue rows may also carry a B2 photo while retaining a useful
-- Google Place identity. Remove only their photo link and attribution fields.
do $$
begin
  if to_regclass('public.static_location_assets') is not null then
    execute $sql$
      update public.static_location_assets asset
      set media_object_id=null,
          photo_provider=null,
          external_photo_id=null,
          attribution_text=null,
          attribution_url=null,
          license_code=null,
          terms_url=null,
          updated_at=now()
      where asset.media_object_id in (select id from photo_reset_media_ids)
    $sql$;
  end if;
end;
$$;

-- These are canonical B2-backed relational photo records. First-party/user
-- media records use different tables and are deliberately not touched.
do $$
begin
  if to_regclass('public.location_photo_sources') is not null then
    execute $sql$
      delete from public.location_photo_sources
      where lower(coalesce(storage_backend,''))='b2'
    $sql$;
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.location_photo_sources') is not null
     and to_regclass('public.static_location_assets') is not null then
    execute $sql$
      delete from public.media_objects media
      where media.id in (select id from photo_reset_media_ids)
        and not exists (
          select 1 from public.location_photo_sources source
          where source.media_object_id=media.id
        )
        and not exists (
          select 1 from public.static_location_assets asset
          where asset.media_object_id=media.id
        )
    $sql$;
  elsif to_regclass('public.location_photo_sources') is not null then
    execute $sql$
      delete from public.media_objects media
      where media.id in (select id from photo_reset_media_ids)
        and not exists (
          select 1 from public.location_photo_sources source
          where source.media_object_id=media.id
        )
    $sql$;
  elsif to_regclass('public.static_location_assets') is not null then
    execute $sql$
      delete from public.media_objects media
      where media.id in (select id from photo_reset_media_ids)
        and not exists (
          select 1 from public.static_location_assets asset
          where asset.media_object_id=media.id
        )
    $sql$;
  else
    execute $sql$
      delete from public.media_objects media
      where media.id in (select id from photo_reset_media_ids)
    $sql$;
  end if;
end;
$$;

do $$
declare
  remaining integer;
begin
  select count(*) into remaining from public.media_objects media
  where media.id in (select id from photo_reset_media_ids);
  if remaining > 0 then
    raise exception 'canonical B2 media rows remain referenced after photo reset: %', remaining;
  end if;
end;
$$;

commit;
