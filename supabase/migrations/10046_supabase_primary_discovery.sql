-- Supabase is the synchronous source for Discover. B2 remains an offline/durable
-- catalogue and media backend, but no object-store read is required to build a deck.
create or replace function public.discovery_primary_overlay_v1(
  center_lat double precision,
  center_lng double precision,
  radius_m integer default 25000,
  max_rows integer default 96,
  search_query text default null,
  category_filter text default null,
  price_filter integer default null,
  amenity_filter text default null,
  accessible_only boolean default false,
  excluded_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid := auth.uid();
  safe_radius integer := least(100000,greatest(1000,coalesce(radius_m,25000)));
  safe_limit integer := least(120,greatest(1,coalesce(max_rows,96)));
  normalized_query text := lower(nullif(trim(search_query),''));
  normalized_category text := nullif(trim(category_filter),'');
  normalized_amenity text := lower(nullif(trim(amenity_filter),''));
  interests jsonb;
  location_rows jsonb;
begin
  if actor is null then raise exception 'authentication required'; end if;

  select coalesce(to_jsonb(profile.interests),'[]'::jsonb)
  into interests
  from public.profiles profile
  where profile.id=actor;

  select coalesce(jsonb_agg(to_jsonb(candidate) order by candidate.distance_m asc), '[]'::jsonb)
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
      (111320.0 * sqrt(
        power(location.latitude-center_lat,2) +
        power((location.longitude-center_lng)*cos(radians(center_lat)),2)
      ))::integer as distance_m
    from public.locations location
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
    where location.status='published'
      and location.visibility='public'
      and location.has_private_address is not true
      and not (location.id=any(coalesce(excluded_ids,'{}'::uuid[])))
      and not exists(
        select 1 from public.static_catalogue_actions action
        where action.user_id=actor
          and action.location_id=location.id
          and action.expires_at>now()
      )
      and location.latitude between center_lat-safe_radius/111320.0 and center_lat+safe_radius/111320.0
      and location.longitude between center_lng-safe_radius/(111320.0*greatest(0.08,cos(radians(center_lat))))
                                 and center_lng+safe_radius/(111320.0*greatest(0.08,cos(radians(center_lat))))
      and (
        location.source<>'import'
        or exists(
          select 1 from public.static_catalogue_materializations materialization
          where materialization.location_id=location.id
            and (materialization.expires_at is null or materialization.expires_at>now())
        )
      )
      and (
        normalized_query is null
        or position(normalized_query in lower(concat_ws(' ',
          location.name,location.summary,location.kind,array_to_string(location.amenities,' ')
        )))>0
      )
      and (normalized_category is null or location.kind=normalized_category)
      and (price_filter is null or location.price_level=price_filter)
      and (
        normalized_amenity is null
        or exists(
          select 1 from unnest(coalesce(location.amenities,'{}'::text[])) amenity
          where position(normalized_amenity in lower(amenity))>0
        )
      )
      and (
        accessible_only is not true
        or coalesce(location.accessibility,'{}'::jsonb) @> '{"wheelchair_accessible":true}'::jsonb
        or coalesce(location.accessibility,'{}'::jsonb) @> '{"step_free":true}'::jsonb
      )
    order by distance_m asc
    limit safe_limit
  ) candidate;

  return jsonb_build_object(
    'dismissedIds','[]'::jsonb,
    'interests',coalesce(interests,'[]'::jsonb),
    'locations',coalesce(location_rows,'[]'::jsonb)
  );
end;
$$;

revoke all on function public.discovery_primary_overlay_v1(
  double precision,double precision,integer,integer,text,text,integer,text,boolean,uuid[]
) from public,anon;
grant execute on function public.discovery_primary_overlay_v1(
  double precision,double precision,integer,integer,text,text,integer,text,boolean,uuid[]
) to authenticated,service_role;
