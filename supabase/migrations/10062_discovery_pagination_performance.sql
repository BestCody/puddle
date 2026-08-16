-- Keep discovery unbounded across pages without sorting the entire radius on every refill.
-- PostGIS KNN ordering can stop once a bounded page of matching, unseen candidates is found.

create or replace function public.r2_discovery_overlay_v2(
  center_lat double precision,
  center_lng double precision,
  radius_m integer default 25000,
  max_rows integer default 60,
  exclude_ids uuid[] default '{}'::uuid[],
  category_filter text default null,
  price_filter integer default null,
  query_filter text default null,
  amenity_filter text default null,
  accessible_only boolean default false,
  open_now_only boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  actor uuid := auth.uid();
  safe_radius integer := least(20040000,greatest(1000,coalesce(radius_m,25000)));
  safe_limit integer := least(100,greatest(1,coalesce(max_rows,60)));
  center_point geography := st_setsrid(st_makepoint(center_lng,center_lat),4326)::geography;
  interests jsonb;
  location_rows jsonb;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if center_lat is null or center_lat not between -90 and 90 or center_lng is null or center_lng not between -180 and 180 then
    raise exception 'invalid discovery center';
  end if;

  select coalesce(to_jsonb(profile.interests),'[]'::jsonb)
  into interests
  from public.profiles profile
  where profile.id=actor;

  with blocked as (
    select seen.id,
      public.discovery_location_group_key_v1(
        seen.duplicate_group_key,seen.catalogue_group_key,seen.name,seen.latitude,seen.longitude
      ) as group_key
    from public.discovery_seen_locations_v1() seen

    union

    select location.id,
      public.discovery_location_group_key_v1(
        location.duplicate_group_key,location.catalogue_group_key,location.name,location.latitude,location.longitude
      ) as group_key
    from public.locations location
    where location.id=any(coalesce(exclude_ids,'{}'::uuid[]))
  ), selected as (
    select location.id
    from public.locations location
    where location.status='published'
      and location.visibility='public'
      and location.has_private_address is not true
      and location.point is not null
      and st_dwithin(location.point,center_point,safe_radius)
      and not exists (
        select 1 from blocked
        where blocked.id=location.id
           or blocked.group_key=public.discovery_location_group_key_v1(
             location.duplicate_group_key,location.catalogue_group_key,location.name,location.latitude,location.longitude
           )
      )
      and (nullif(category_filter,'') is null or location.kind=category_filter)
      and (price_filter is null or location.price_level=price_filter)
      and (
        nullif(query_filter,'') is null
        or position(lower(query_filter) in lower(concat_ws(' ',location.name,location.summary,location.kind,array_to_string(location.amenities,' '))))>0
      )
      and (
        nullif(amenity_filter,'') is null
        or exists (
          select 1 from unnest(coalesce(location.amenities,'{}'::text[])) amenity
          where position(lower(amenity_filter) in lower(amenity))>0
        )
      )
      and (
        not accessible_only
        or lower(coalesce(location.accessibility->>'wheelchair_accessible','false')) in ('true','1','yes')
        or lower(coalesce(location.accessibility->>'step_free','false')) in ('true','1','yes')
      )
      and (not open_now_only or public.discovery_is_open_now_v1(location.opening_hours,location.timezone,now()))
    order by location.point <-> center_point,location.id
    limit safe_limit
  )
  select coalesce(jsonb_agg(to_jsonb(candidate) order by candidate.distance_m,candidate.id), '[]'::jsonb)
  into location_rows
  from (
    select
      location.id,location.slug,location.name,location.summary,location.kind,
      location.timezone,location.timezone_verified,location.price_level,
      location.accessibility,location.amenities,location.opening_hours,
      location.latitude,location.longitude,location.neighborhood,location.city,
      location.region,location.region_code,location.country,location.country_code,
      location.postal_code,location.address_public,location.brand_id,location.brand_name,
      location.source_parent_place_id,location.duplicate_group_key,location.catalogue_group_key,
      location.cover_path,location.source,location.published_at,location.updated_at,
      google.google_place_id,google.match_score as google_place_match_score,
      photo.photo_url,photo.provider as photo_provider,
      photo.attribution_text as photo_attribution,
      photo.attribution_url as photo_attribution_url,
      photo.license_code as photo_license,
      st_distance(location.point,center_point)::integer as distance_m
    from selected
    join public.locations location on location.id=selected.id
    left join lateral (
      select mapping.google_place_id,mapping.match_score
      from public.location_google_places mapping
      where mapping.location_id=location.id and mapping.status='verified'
      order by mapping.matched_at desc nulls last
      limit 1
    ) google on true
    left join lateral (
      select coalesce(media.public_url,source.remote_url) as photo_url,
        source.provider,source.attribution_text,source.attribution_url,source.license_code
      from public.location_photo_sources source
      left join public.media_objects media on media.id=source.media_object_id
      where source.location_id=location.id
        and source.status='approved'
        and source.is_ai_generated is not true
        and (source.expires_at is null or source.expires_at>now())
      order by source.is_primary desc nulls last,source.sort_order asc,source.verified_at desc nulls last
      limit 1
    ) photo on true
  ) candidate;

  return jsonb_build_object(
    'dismissedIds','[]'::jsonb,
    'interests',coalesce(interests,'[]'::jsonb),
    'locations',coalesce(location_rows,'[]'::jsonb)
  );
end;
$$;

revoke all on function public.r2_discovery_overlay_v2(double precision,double precision,integer,integer,uuid[],text,integer,text,text,boolean,boolean) from public,anon;
grant execute on function public.r2_discovery_overlay_v2(double precision,double precision,integer,integer,uuid[],text,integer,text,text,boolean,boolean) to authenticated;
