-- Materialize an immutable R2 catalogue record only after a meaningful user action.
-- The service role supplies a deterministic UUID. Existing catalogue upsert logic
-- then fills the full normalized record and source metadata.

create or replace function public.materialize_static_catalogue_location_v1(
  target_location uuid,
  import_source text,
  payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  source_id text := nullif(trim(payload->>'source_place_id'), '');
  place_name text := nullif(trim(payload->>'name'), '');
  place_slug text := nullif(trim(payload->>'slug'), '');
  place_kind text := nullif(trim(payload->>'kind'), '');
  place_city text := coalesce(
    nullif(trim(payload->>'city'), ''),
    nullif(trim(payload->>'region'), ''),
    nullif(trim(payload->>'country'), ''),
    'Unspecified locality'
  );
  place_latitude double precision;
  place_longitude double precision;
  mapped_location uuid;
begin
  if target_location is null then raise exception 'target location is required'; end if;
  if import_source not in ('overture', 'fsq_os') then raise exception 'unsupported catalogue source'; end if;
  if source_id is null or char_length(source_id) > 240 then raise exception 'invalid source place id'; end if;
  if place_name is null or char_length(place_name) not between 2 and 120 then raise exception 'invalid place name'; end if;
  if place_slug is null or place_slug !~ '^[a-z0-9-]{3,100}$' then raise exception 'invalid place slug'; end if;
  if place_kind not in (
    'cafe','restaurant','bar','park','museum','gallery','attraction','activity_venue',
    'study_spot','scenic_spot','nightlife','shop','community_space','other'
  ) then raise exception 'invalid place kind'; end if;

  place_latitude := (payload->>'latitude')::double precision;
  place_longitude := (payload->>'longitude')::double precision;
  if place_latitude not between -90 and 90 or place_longitude not between -180 and 180 then
    raise exception 'invalid place coordinates';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(import_source || ':' || source_id, 0));

  select location_id into mapped_location
  from public.location_source_links
  where source = import_source and source_place_id = source_id;
  if mapped_location is not null then return mapped_location; end if;

  if exists (
    select 1 from public.locations location
    where location.id = target_location
      and not exists (
        select 1 from public.location_source_links link
        where link.location_id = location.id
          and link.source = import_source
          and link.source_place_id = source_id
      )
  ) then
    raise exception 'deterministic location id is already in use';
  end if;

  insert into public.locations(
    id, name, slug, kind, summary, city, neighborhood, region, region_code,
    country, country_code, postal_code, address_public, latitude, longitude,
    timezone, timezone_verified, timezone_source, amenities, accessibility,
    opening_hours, price_level, website_url, phone_public, brand_id, brand_name,
    source_parent_place_id, duplicate_group_key, catalogue_group_key,
    category_confidence, normalization_version, category_mapping_version,
    source_operating_status, source_metadata, status, visibility,
    has_private_address, source, photo_enrichment_status, published_at
  ) values (
    target_location, place_name, place_slug, place_kind,
    nullif(trim(payload->>'summary'), ''), place_city,
    nullif(trim(payload->>'neighborhood'), ''), nullif(trim(payload->>'region'), ''),
    nullif(trim(payload->>'region_code'), ''), nullif(trim(payload->>'country'), ''),
    nullif(trim(payload->>'country_code'), ''), nullif(trim(payload->>'postal_code'), ''),
    nullif(trim(payload->>'address_public'), ''), place_latitude, place_longitude,
    coalesce(nullif(trim(payload->>'timezone'), ''), 'UTC'),
    nullif(trim(payload->>'timezone'), '') is not null,
    case when nullif(trim(payload->>'timezone'), '') is not null then import_source else null end,
    coalesce(array(select jsonb_array_elements_text(coalesce(payload->'amenities', '[]'::jsonb))), '{}'::text[]),
    case when jsonb_typeof(coalesce(payload->'accessibility', '{}'::jsonb)) = 'object'
      then coalesce(payload->'accessibility', '{}'::jsonb) else '{}'::jsonb end,
    case when jsonb_typeof(coalesce(payload->'opening_hours', '{}'::jsonb)) = 'object'
      then coalesce(payload->'opening_hours', '{}'::jsonb) else '{}'::jsonb end,
    nullif(payload->>'price_level', '')::smallint,
    nullif(trim(payload->>'website_url'), ''), nullif(trim(payload->>'phone_public'), ''),
    nullif(trim(payload->>'brand_id'), ''), nullif(trim(payload->>'brand_name'), ''),
    nullif(trim(payload->>'source_parent_place_id'), ''),
    nullif(trim(payload->>'duplicate_group_key'), ''),
    nullif(trim(payload->>'catalogue_group_key'), ''),
    nullif(payload->>'category_confidence', '')::numeric,
    nullif(payload->>'normalization_version', '')::integer,
    nullif(payload->>'category_mapping_version', '')::integer,
    nullif(trim(payload->>'source_operating_status'), ''),
    case when jsonb_typeof(coalesce(payload->'source_metadata', '{}'::jsonb)) = 'object'
      then coalesce(payload->'source_metadata', '{}'::jsonb) else '{}'::jsonb end,
    'published', 'public', false, 'import', 'pending', now()
  ) on conflict (id) do nothing;

  insert into public.location_source_links(
    source, source_place_id, location_id, source_confidence, source_updated_at,
    last_seen_at, payload_hash, source_parent_place_id, source_brand_id,
    source_release_id, source_operating_status, normalization_version,
    category_mapping_version, source_metadata, missed_refreshes, stale_since,
    created_at, updated_at
  ) values (
    import_source, source_id, target_location,
    nullif(payload->>'source_confidence', '')::numeric,
    nullif(payload->>'source_updated_at', '')::timestamptz,
    now(), nullif(trim(payload->>'payload_hash'), ''),
    nullif(trim(payload->>'source_parent_place_id'), ''),
    nullif(trim(payload->>'brand_id'), ''),
    nullif(trim(payload->>'source_release_id'), ''),
    nullif(trim(payload->>'source_operating_status'), ''),
    nullif(payload->>'normalization_version', '')::integer,
    nullif(payload->>'category_mapping_version', '')::integer,
    case when jsonb_typeof(coalesce(payload->'source_metadata', '{}'::jsonb)) = 'object'
      then coalesce(payload->'source_metadata', '{}'::jsonb) else '{}'::jsonb end,
    0, null, now(), now()
  ) on conflict (source, source_place_id) do nothing;

  select location_id into mapped_location
  from public.location_source_links
  where source = import_source and source_place_id = source_id;

  if mapped_location is distinct from target_location then
    delete from public.locations orphan
    where orphan.id = target_location
      and orphan.source = 'import'
      and not exists (select 1 from public.location_source_links link where link.location_id = orphan.id);
    return mapped_location;
  end if;

  return public.upsert_open_catalogue_location_v1(import_source, payload);
end;
$$;

revoke all on function public.materialize_static_catalogue_location_v1(uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.materialize_static_catalogue_location_v1(uuid,text,jsonb)
  to service_role;
