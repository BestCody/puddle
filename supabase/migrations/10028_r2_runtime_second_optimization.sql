-- Second R2 runtime optimization pass: one relational overlay RPC, batched actions,
-- sampled analytics, compact dismissals, batched materialization, and batched cleanup.

-- Compact static dismissals to the three values required by the feed and undo path.
drop index if exists public.static_catalogue_actions_expiry_idx;
alter table public.static_catalogue_actions
  drop column if exists source,
  drop column if exists source_place_id,
  drop column if exists action,
  drop column if exists last_request_id,
  drop column if exists created_at,
  drop column if exists updated_at;
create index if not exists static_catalogue_actions_expiry_idx
  on public.static_catalogue_actions(expires_at);

create or replace function public.record_static_catalogue_action_v1(
  target_location uuid,
  import_source text,
  source_place_id text,
  action_name text,
  request_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'authentication required'; end if;
  if target_location is null then raise exception 'target location is required'; end if;
  if action_name='undo' then
    delete from public.static_catalogue_actions
    where user_id=actor and location_id=target_location;
    return jsonb_build_object('action','undo','locationId',target_location);
  end if;
  if action_name<>'dismissed' then raise exception 'unsupported static action'; end if;
  insert into public.static_catalogue_actions(user_id,location_id,expires_at)
  values(actor,target_location,now()+interval '90 days')
  on conflict(user_id,location_id) do update
    set expires_at=excluded.expires_at;
  return jsonb_build_object('action','dismissed','locationId',target_location);
end;
$$;
revoke all on function public.record_static_catalogue_action_v1(uuid,text,text,text,uuid) from public,anon;
grant execute on function public.record_static_catalogue_action_v1(uuid,text,text,text,uuid) to authenticated;

-- One bounded row replaces multiple recommendation/impression analytics rows.
create table if not exists public.discovery_session_samples (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  static_release text,
  ranking_version text,
  center_lat double precision,
  center_lng double precision,
  filters jsonb not null default '{}'::jsonb,
  candidate_ids uuid[] not null default '{}'::uuid[],
  rank_positions smallint[] not null default '{}'::smallint[],
  score_summary jsonb not null default '{}'::jsonb,
  static_count smallint not null default 0,
  relational_count smallint not null default 0,
  unique(user_id,request_id)
);
create index if not exists discovery_session_samples_created_idx
  on public.discovery_session_samples(created_at);
alter table public.discovery_session_samples enable row level security;
revoke all on table public.discovery_session_samples from public,anon,authenticated;
grant select,insert,delete on table public.discovery_session_samples to service_role;

create or replace function public.record_discovery_session_sample_v1(sample jsonb)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'authentication required'; end if;
  insert into public.discovery_session_samples(
    user_id,request_id,static_release,ranking_version,center_lat,center_lng,
    filters,candidate_ids,rank_positions,score_summary,static_count,relational_count
  ) values (
    actor,
    (sample->>'requestId')::uuid,
    nullif(sample->>'staticRelease',''),
    nullif(sample->>'rankingVersion',''),
    nullif(sample->>'centerLat','')::double precision,
    nullif(sample->>'centerLng','')::double precision,
    coalesce(sample->'filters','{}'::jsonb),
    coalesce(array(select value::uuid from jsonb_array_elements_text(coalesce(sample->'candidateIds','[]'::jsonb))), '{}'::uuid[]),
    coalesce(array(select value::smallint from jsonb_array_elements_text(coalesce(sample->'rankPositions','[]'::jsonb))), '{}'::smallint[]),
    coalesce(sample->'scoreSummary','{}'::jsonb),
    least(32767,greatest(0,coalesce((sample->>'staticCount')::integer,0)))::smallint,
    least(32767,greatest(0,coalesce((sample->>'relationalCount')::integer,0)))::smallint
  ) on conflict(user_id,request_id) do nothing;
  return true;
end;
$$;
revoke all on function public.record_discovery_session_sample_v1(jsonb) from public,anon;
grant execute on function public.record_discovery_session_sample_v1(jsonb) to authenticated;

-- R2 is the primary candidate source. This RPC returns only relational overrides,
-- user/venue-created nearby locations, compact dismissals, and profile interests.
create or replace function public.r2_discovery_overlay_v1(
  static_ids uuid[],
  center_lat double precision,
  center_lng double precision,
  radius_m integer default 25000,
  max_rows integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid := auth.uid();
  safe_radius integer := least(100000,greatest(1000,coalesce(radius_m,25000)));
  safe_limit integer := least(120,greatest(1,coalesce(max_rows,60)));
  dismissed jsonb;
  interests jsonb;
  location_rows jsonb;
begin
  if actor is null then raise exception 'authentication required'; end if;

  select coalesce(jsonb_agg(action.location_id), '[]'::jsonb)
  into dismissed
  from public.static_catalogue_actions action
  where action.user_id=actor
    and action.expires_at>now()
    and action.location_id=any(coalesce(static_ids,'{}'::uuid[]));

  select coalesce(to_jsonb(profile.interests),'[]'::jsonb)
  into interests
  from public.profiles profile
  where profile.id=actor;

  select coalesce(jsonb_agg(to_jsonb(candidate) order by candidate.distance_m asc), '[]'::jsonb)
  into location_rows
  from (
    select
      location.id,
      location.slug,
      location.name,
      location.summary,
      location.kind,
      location.timezone,
      location.timezone_verified,
      location.price_level,
      location.accessibility,
      location.amenities,
      location.opening_hours,
      location.latitude,
      location.longitude,
      location.neighborhood,
      location.city,
      location.region,
      location.region_code,
      location.country,
      location.country_code,
      location.postal_code,
      location.address_public,
      location.brand_id,
      location.brand_name,
      location.source_parent_place_id,
      location.duplicate_group_key,
      location.catalogue_group_key,
      location.cover_path,
      location.source,
      location.published_at,
      location.updated_at,
      google.google_place_id,
      google.match_score as google_place_match_score,
      photo.photo_url,
      photo.provider as photo_provider,
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
      select
        coalesce(media.public_url,source.remote_url) as photo_url,
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
      and location.latitude between center_lat-safe_radius/111320.0 and center_lat+safe_radius/111320.0
      and location.longitude between center_lng-safe_radius/(111320.0*greatest(0.08,cos(radians(center_lat))))
                                 and center_lng+safe_radius/(111320.0*greatest(0.08,cos(radians(center_lat))))
      and (
        location.id=any(coalesce(static_ids,'{}'::uuid[]))
        or location.source<>'import'
        or exists(
          select 1 from public.static_catalogue_materializations materialization
          where materialization.location_id=location.id
            and (materialization.expires_at is null or materialization.expires_at>now())
        )
      )
    order by distance_m asc
    limit safe_limit
  ) candidate;

  return jsonb_build_object(
    'dismissedIds',coalesce(dismissed,'[]'::jsonb),
    'interests',coalesce(interests,'[]'::jsonb),
    'locations',coalesce(location_rows,'[]'::jsonb)
  );
end;
$$;
revoke all on function public.r2_discovery_overlay_v1(uuid[],double precision,double precision,integer,integer) from public,anon;
grant execute on function public.r2_discovery_overlay_v1(uuid[],double precision,double precision,integer,integer) to authenticated;

-- Materialize all records in one service-role transaction after Node has fetched each
-- referenced tile only once.
create or replace function public.materialize_static_catalogue_locations_v2(items jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  item jsonb;
  requested_id uuid;
  mapped_id uuid;
  result jsonb := '[]'::jsonb;
begin
  if coalesce(auth.role()::text,'')<>'service_role' then raise exception 'service role required'; end if;
  if jsonb_typeof(coalesce(items,'[]'::jsonb))<>'array' then raise exception 'items must be an array'; end if;
  if jsonb_array_length(coalesce(items,'[]'::jsonb))>50 then raise exception 'too many materializations'; end if;
  for item in select value from jsonb_array_elements(coalesce(items,'[]'::jsonb)) loop
    requested_id := (item->>'targetLocation')::uuid;
    mapped_id := public.materialize_static_catalogue_location_v1(
      requested_id,
      item->>'source',
      item->'payload'
    );
    result := result || jsonb_build_array(jsonb_build_object('requestedId',requested_id,'locationId',mapped_id));
  end loop;
  return result;
end;
$$;
revoke all on function public.materialize_static_catalogue_locations_v2(jsonb) from public,anon,authenticated;
grant execute on function public.materialize_static_catalogue_locations_v2(jsonb) to service_role;

-- Preserve action ordering while paying the HTTP/auth/rate-limit overhead once.
create or replace function public.record_discovery_actions_v3(actions jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  item jsonb;
  result jsonb := '[]'::jsonb;
  action_result jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if jsonb_typeof(coalesce(actions,'[]'::jsonb))<>'array' then raise exception 'actions must be an array'; end if;
  if jsonb_array_length(coalesce(actions,'[]'::jsonb)) not between 1 and 20 then raise exception 'invalid action batch size'; end if;
  for item in select value from jsonb_array_elements(actions) loop
    action_result := public.record_discovery_action_v2(
      coalesce(item->>'contentKind','place'),
      (item->>'contentId')::uuid,
      item->>'action',
      coalesce(item->>'requestedAction',item->>'action'),
      nullif(item->>'requestId','')::uuid,
      coalesce(item#>>'{context,mode}','solo'),
      nullif(item#>>'{context,category}',''),
      coalesce(item->'context'->'payload','{}'::jsonb),
      coalesce((item->>'staticEphemeral')::boolean,false),
      nullif(item->>'staticSource',''),
      nullif(item->>'staticSourcePlaceId','')
    );
    result := result || jsonb_build_array(action_result || jsonb_build_object(
      'eventId',nullif(item->>'eventId',''),
      'sequence',coalesce((item->>'sequence')::integer,0)
    ));
  end loop;
  return result;
end;
$$;
revoke all on function public.record_discovery_actions_v3(jsonb) from public,anon;
grant execute on function public.record_discovery_actions_v3(jsonb) to authenticated;

-- Delete expired attribution rows and cold relational copies in one database call,
-- then return unreferenced R2 objects for bounded parallel deletion by the worker.
create or replace function public.prepare_r2_cleanup_v1(
  photo_limit integer default 500,
  location_limit integer default 500
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
  deleted_locations integer := 0;
  location_row record;
  orphan_rows jsonb;
begin
  if coalesce(auth.role()::text,'')<>'service_role' then raise exception 'service role required'; end if;

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
    'expiredPhotoRows',expired_count,
    'changedLocationIds',to_jsonb(changed_locations),
    'deletedLocations',deleted_locations,
    'orphanMedia',coalesce(orphan_rows,'[]'::jsonb)
  );
end;
$$;
revoke all on function public.prepare_r2_cleanup_v1(integer,integer) from public,anon,authenticated;
grant execute on function public.prepare_r2_cleanup_v1(integer,integer) to service_role;

create or replace function public.delete_unreferenced_media_objects_v1(media_ids uuid[])
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare changed integer;
begin
  if coalesce(auth.role()::text,'')<>'service_role' then raise exception 'service role required'; end if;
  delete from public.media_objects object
  where object.id=any(coalesce(media_ids,'{}'::uuid[]))
    and not exists(select 1 from public.location_photo_sources source where source.media_object_id=object.id);
  get diagnostics changed=row_count;
  return changed;
end;
$$;
revoke all on function public.delete_unreferenced_media_objects_v1(uuid[]) from public,anon,authenticated;
grant execute on function public.delete_unreferenced_media_objects_v1(uuid[]) to service_role;
