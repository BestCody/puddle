-- Compact static-catalogue media and Google metadata. These rows enrich B2-only
-- catalogue cards without creating a full public.locations row.

create table if not exists public.static_location_assets (
  static_location_id uuid primary key,
  source text not null check (source in ('overture','fsq_os')),
  source_place_id text not null check (char_length(source_place_id) between 1 and 240),

  media_object_id uuid references public.media_objects(id) on delete restrict,
  photo_provider text,
  external_photo_id text,
  attribution_text text,
  attribution_url text,
  license_code text,
  terms_url text,

  google_place_id text,
  google_match_score real check (google_match_score is null or google_match_score between 0 and 1),
  google_matched_name text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (source, source_place_id),
  check (
    media_object_id is null or (
      nullif(trim(photo_provider),'') is not null and
      nullif(trim(external_photo_id),'') is not null and
      nullif(trim(attribution_text),'') is not null and
      nullif(trim(attribution_url),'') is not null and
      nullif(trim(license_code),'') is not null and
      nullif(trim(terms_url),'') is not null
    )
  ),
  check (google_place_id is null or nullif(trim(google_matched_name),'') is not null)
);

create index if not exists static_location_assets_media_idx
  on public.static_location_assets(media_object_id)
  where media_object_id is not null;
create index if not exists static_location_assets_google_idx
  on public.static_location_assets(google_place_id)
  where google_place_id is not null;

alter table public.static_location_assets enable row level security;
revoke all on table public.static_location_assets from public,anon,authenticated;
grant select,insert,update,delete on table public.static_location_assets to service_role;

comment on table public.static_location_assets is
  'Compact media and stable Google Place ID metadata for B2-only catalogue cards. No Google image bytes or photo resource names are stored.';

create or replace function public.attach_static_location_asset_v1(
  target_location uuid,
  target_static_location uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  asset public.static_location_assets%rowtype;
  media public.media_objects%rowtype;
begin
  if target_location is null or target_static_location is null then return; end if;
  select * into asset
  from public.static_location_assets
  where static_location_id=target_static_location;
  if not found then return; end if;

  if asset.media_object_id is not null then
    select * into media from public.media_objects where id=asset.media_object_id;
    if found then
      insert into public.location_photo_sources(
        location_id,source,provider,external_photo_id,remote_url,
        attribution_text,attribution_url,license_code,terms_url,
        width,height,is_primary,sort_order,status,is_ai_generated,
        verified_at,expires_at,cache_ttl_seconds,storage_backend,media_object_id
      ) values (
        target_location,'licensed_public',asset.photo_provider,asset.external_photo_id,media.public_url,
        asset.attribution_text,asset.attribution_url,asset.license_code,asset.terms_url,
        media.width,media.height,true,0,'approved',false,
        now(),null,86400,'b2',media.id
      )
      on conflict(location_id,provider,external_photo_id) do update set
        remote_url=excluded.remote_url,
        attribution_text=excluded.attribution_text,
        attribution_url=excluded.attribution_url,
        license_code=excluded.license_code,
        terms_url=excluded.terms_url,
        width=excluded.width,
        height=excluded.height,
        is_primary=true,
        sort_order=0,
        status='approved',
        is_ai_generated=false,
        verified_at=now(),
        expires_at=null,
        cache_ttl_seconds=86400,
        storage_backend='b2',
        media_object_id=excluded.media_object_id;
    end if;
  end if;

  if asset.google_place_id is not null then
    insert into public.location_google_places(
      location_id,google_place_id,status,match_score,matched_name,matched_at
    ) values (
      target_location,asset.google_place_id,'verified',asset.google_match_score,
      asset.google_matched_name,now()
    )
    on conflict(location_id) do update set
      google_place_id=excluded.google_place_id,
      status='verified',
      match_score=excluded.match_score,
      matched_name=excluded.matched_name,
      matched_at=now();

    update public.static_catalogue_materializations
    set last_touched_at=now(),
        retention_class=case
          when retention_class in ('photo') then retention_class
          else 'google'
        end,
        expires_at=null
    where location_id=target_location;
  end if;
end;
$$;
revoke all on function public.attach_static_location_asset_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.attach_static_location_asset_v1(uuid,uuid) to service_role;

create or replace function public.static_location_assets_attach_materialized_v1()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  target uuid;
begin
  select location_id into target
  from public.static_catalogue_materializations
  where source=new.source and source_place_id=new.source_place_id;
  if target is not null then
    perform public.attach_static_location_asset_v1(target,new.static_location_id);
  end if;
  return new;
end;
$$;

revoke all on function public.static_location_assets_attach_materialized_v1() from public,anon,authenticated;

drop trigger if exists static_location_assets_attach_materialized on public.static_location_assets;
create trigger static_location_assets_attach_materialized
after insert or update of media_object_id,photo_provider,external_photo_id,attribution_text,
  attribution_url,license_code,terms_url,google_place_id,google_match_score,google_matched_name
on public.static_location_assets
for each row execute function public.static_location_assets_attach_materialized_v1();

create or replace function public.static_materialization_attach_asset_v1()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  asset_id uuid;
begin
  select static_location_id into asset_id
  from public.static_location_assets
  where source=new.source and source_place_id=new.source_place_id;
  if asset_id is not null then
    perform public.attach_static_location_asset_v1(new.location_id,asset_id);
  end if;
  return new;
end;
$$;

revoke all on function public.static_materialization_attach_asset_v1() from public,anon,authenticated;

drop trigger if exists static_materialization_attach_asset on public.static_catalogue_materializations;
create trigger static_materialization_attach_asset
after insert or update of source,source_place_id
on public.static_catalogue_materializations
for each row execute function public.static_materialization_attach_asset_v1();

create or replace function public.upsert_static_location_asset_v1(
  target_static_location uuid,
  import_source text,
  import_source_place_id text,
  photo_media_object uuid default null,
  photo_provider_value text default null,
  external_photo_value text default null,
  attribution_text_value text default null,
  attribution_url_value text default null,
  license_code_value text default null,
  terms_url_value text default null,
  google_place_value text default null,
  google_score_value real default null,
  google_name_value text default null
)
returns public.static_location_assets
language plpgsql
security definer
set search_path=public
as $$
declare
  result public.static_location_assets%rowtype;
begin
  if coalesce(auth.role()::text,'') <> 'service_role' then raise exception 'service role required'; end if;
  if target_static_location is null then raise exception 'static location id is required'; end if;
  if import_source not in ('overture','fsq_os') then raise exception 'unsupported catalogue source'; end if;
  if nullif(trim(import_source_place_id),'') is null or char_length(import_source_place_id)>240 then
    raise exception 'invalid source place id';
  end if;
  if photo_media_object is not null and (
    nullif(trim(photo_provider_value),'') is null or
    nullif(trim(external_photo_value),'') is null or
    nullif(trim(attribution_text_value),'') is null or
    nullif(trim(attribution_url_value),'') is null or
    nullif(trim(license_code_value),'') is null or
    nullif(trim(terms_url_value),'') is null
  ) then raise exception 'complete photo attribution and licence metadata is required'; end if;
  if google_place_value is not null and nullif(trim(google_name_value),'') is null then
    raise exception 'Google matched name is required';
  end if;

  insert into public.static_location_assets(
    static_location_id,source,source_place_id,
    media_object_id,photo_provider,external_photo_id,attribution_text,attribution_url,license_code,terms_url,
    google_place_id,google_match_score,google_matched_name,created_at,updated_at
  ) values (
    target_static_location,import_source,import_source_place_id,
    photo_media_object,photo_provider_value,external_photo_value,attribution_text_value,attribution_url_value,license_code_value,terms_url_value,
    google_place_value,google_score_value,google_name_value,now(),now()
  )
  on conflict(static_location_id) do update set
    source=excluded.source,
    source_place_id=excluded.source_place_id,
    media_object_id=coalesce(excluded.media_object_id,static_location_assets.media_object_id),
    photo_provider=coalesce(excluded.photo_provider,static_location_assets.photo_provider),
    external_photo_id=coalesce(excluded.external_photo_id,static_location_assets.external_photo_id),
    attribution_text=coalesce(excluded.attribution_text,static_location_assets.attribution_text),
    attribution_url=coalesce(excluded.attribution_url,static_location_assets.attribution_url),
    license_code=coalesce(excluded.license_code,static_location_assets.license_code),
    terms_url=coalesce(excluded.terms_url,static_location_assets.terms_url),
    google_place_id=coalesce(excluded.google_place_id,static_location_assets.google_place_id),
    google_match_score=coalesce(excluded.google_match_score,static_location_assets.google_match_score),
    google_matched_name=coalesce(excluded.google_matched_name,static_location_assets.google_matched_name),
    updated_at=now()
  returning * into result;
  return result;
end;
$$;
revoke all on function public.upsert_static_location_asset_v1(uuid,text,text,uuid,text,text,text,text,text,text,text,real,text) from public,anon,authenticated;
grant execute on function public.upsert_static_location_asset_v1(uuid,text,text,uuid,text,text,text,text,text,text,text,real,text) to service_role;

create or replace function public.static_catalogue_launch_database_bytes_v1()
returns bigint
language sql
security definer
set search_path=public
as $$
  select pg_database_size(current_database());
$$;
revoke all on function public.static_catalogue_launch_database_bytes_v1() from public,anon,authenticated;
grant execute on function public.static_catalogue_launch_database_bytes_v1() to service_role;
