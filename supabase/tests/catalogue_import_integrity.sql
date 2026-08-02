\set ON_ERROR_STOP on
begin;

\echo 'catalogue integrity: verify RPC permissions'
do $$
begin
  if to_regprocedure('public.upsert_open_catalogue_batch_v1(text,jsonb)') is null then
    raise exception 'catalogue batch RPC is missing';
  end if;
  if not has_function_privilege(
    'service_role',
    to_regprocedure('public.upsert_open_catalogue_batch_v1(text,jsonb)'),
    'EXECUTE'
  ) then
    raise exception 'service_role cannot execute catalogue batch RPC';
  end if;
  if has_function_privilege(
    'authenticated',
    to_regprocedure('public.upsert_open_catalogue_batch_v1(text,jsonb)'),
    'EXECUTE'
  ) then
    raise exception 'authenticated role can execute private catalogue batch RPC';
  end if;
  if not has_function_privilege('service_role',to_regprocedure('public.begin_catalogue_region_refresh_v1(uuid,text,text)'),'EXECUTE') then
    raise exception 'service_role cannot start regional reconciliation';
  end if;
  if not has_function_privilege('service_role',to_regprocedure('public.claim_open_photo_candidates_v1(integer,uuid)'),'EXECUTE') then
    raise exception 'service_role cannot claim photo candidates';
  end if;
end $$;

insert into public.catalogue_sync_regions(
  region_key,center_latitude,center_longitude,radius_km,source,status
) values (
  'catalogue-integrity-region',43.4791,-79.648,25,'overture','processing'
) returning id as test_region_id \gset

select public.begin_catalogue_region_refresh_v1(:'test_region_id','overture','2026-07-23.0');

\echo 'catalogue integrity: import one current-style rich record'
create temporary table first_import as
select * from public.upsert_open_catalogue_batch_v1(
  'overture',
  jsonb_build_array(jsonb_build_object(
    'source_place_id','overture-test-cafe',
    'source_updated_at','2026-06-17T00:00:00Z',
    'source_confidence',0.97,
    'source_operating_status','open',
    'source_release_id','2026-07-23.0',
    'catalogue_region_id',:'test_region_id',
    'normalization_version',2,
    'category_mapping_version',2,
    'source_metadata',jsonb_build_object('source_categories',jsonb_build_object('primary',jsonb_build_array('coffee_shop'))),
    'payload_hash',repeat('a',64),
    'name','Catalogue Integrity Cafe',
    'slug','catalogue-integrity-cafe-a1b2c3d4',
    'kind','cafe',
    'category_confidence',0.98,
    'summary','A cafe in Oakville. Opening hours and other details are shown only when verified.',
    'city','Oakville',
    'region','Ontario',
    'region_code','ON',
    'country','Canada',
    'country_code','CA',
    'postal_code','L6J 1H4',
    'address_public','123 Lakeshore Road',
    'latitude',43.4791,
    'longitude',-79.648,
    'timezone','America/Toronto',
    'amenities',jsonb_build_array('coffee','wifi'),
    'accessibility',jsonb_build_object('wheelchair_accessible',true),
    'opening_hours',jsonb_build_object('monday','08:00-18:00'),
    'price_level',2,
    'website_url','https://example.com/catalogue-cafe',
    'phone_public','+1 905 555 0100',
    'brand_id','catalogue-coffee',
    'brand_name','Catalogue Coffee',
    'duplicate_group_key','catalogue-integrity-cafe|123-lakeshore|43.4791:-79.6480',
    'catalogue_group_key','overture:overture-test-cafe'
  ))
);

do $$
declare
  imported record;
begin
  select * into imported from first_import limit 1;
  if imported is null then raise exception 'catalogue batch returned no result'; end if;
  if imported.error_message is not null then raise exception 'valid catalogue import failed: %', imported.error_message; end if;
  if imported.location_id is null then raise exception 'valid catalogue import returned no location ID'; end if;
end $$;

do $$
declare
  linked_count integer;
  description_count integer;
  canonical_count integer;
  membership_count integer;
  geography_count integer;
begin
  select count(*) into linked_count
  from public.location_source_links
  where source='overture' and source_place_id='overture-test-cafe'
    and source_release_id='2026-07-23.0' and normalization_version=2 and category_mapping_version=2;
  if linked_count <> 1 then raise exception 'expected one versioned source link, found %', linked_count; end if;

  select count(*) into description_count
  from public.location_descriptions d
  join public.location_source_links s on s.location_id=d.location_id
  where s.source='overture' and s.source_place_id='overture-test-cafe'
    and d.source='generated_factual' and d.status='approved';
  if description_count <> 1 then raise exception 'expected one approved generated description, found %', description_count; end if;

  select count(*) into canonical_count
  from public.locations l
  join public.location_source_links s on s.location_id=l.id
  where s.source='overture' and s.source_place_id='overture-test-cafe'
    and l.status='published' and l.visibility='public' and l.source='import';
  if canonical_count <> 1 then raise exception 'expected one published imported location, found %', canonical_count; end if;

  select count(*) into geography_count
  from public.locations l
  join public.location_source_links s on s.location_id=l.id
  where s.source='overture' and s.source_place_id='overture-test-cafe'
    and l.city='Oakville' and l.region='Ontario' and l.region_code='ON'
    and l.country='Canada' and l.country_code='CA' and l.postal_code='L6J 1H4'
    and l.timezone='America/Toronto' and l.timezone_verified
    and l.brand_id='catalogue-coffee' and l.brand_name='Catalogue Coffee'
    and l.category_confidence=0.98 and l.normalization_version=2 and l.category_mapping_version=2
    and l.opening_hours->>'monday'='08:00-18:00'
    and l.accessibility->>'wheelchair_accessible'='true';
  if geography_count <> 1 then raise exception 'rich catalogue geography or metadata was not stored'; end if;

  select count(*) into membership_count
  from public.catalogue_region_locations
  where region_id=:'test_region_id' and source='overture'
    and source_place_id='overture-test-cafe' and present_in_latest_release;
  if membership_count <> 1 then raise exception 'expected one current regional membership, found %', membership_count; end if;
end $$;

\echo 'catalogue integrity: connect a child place to its imported parent'
create temporary table child_import as
select * from public.upsert_open_catalogue_batch_v1(
  'overture',
  jsonb_build_array(jsonb_build_object(
    'source_place_id','overture-test-playground',
    'source_parent_place_id','overture-test-cafe',
    'source_release_id','2026-07-23.0',
    'catalogue_region_id',:'test_region_id',
    'normalization_version',2,
    'category_mapping_version',2,
    'payload_hash',repeat('d',64),
    'name','Catalogue Integrity Playground',
    'slug','catalogue-integrity-playground-a1b2c3d4',
    'kind','park',
    'category_confidence',0.9,
    'summary','A playground in Oakville. Opening hours and other details are shown only when verified.',
    'city','Oakville','region','Ontario','region_code','ON','country','Canada','country_code','CA',
    'latitude',43.4792,'longitude',-79.6481,'timezone','America/Toronto',
    'amenities','[]'::jsonb,'accessibility','{}'::jsonb,'opening_hours','{}'::jsonb,
    'duplicate_group_key','catalogue-integrity-playground',
    'catalogue_group_key','overture:overture-test-cafe'
  ))
);

do $$
declare
  child_result record;
  relationship_count integer;
begin
  select * into child_result from child_import limit 1;
  if child_result.error_message is not null then raise exception 'child import failed: %', child_result.error_message; end if;
  select count(*) into relationship_count
  from public.locations child
  join public.location_source_links child_link on child_link.location_id=child.id
  join public.location_source_links parent_link on parent_link.location_id=child.parent_location_id
  where child_link.source='overture' and child_link.source_place_id='overture-test-playground'
    and parent_link.source='overture' and parent_link.source_place_id='overture-test-cafe'
    and child.catalogue_group_key='overture:overture-test-cafe';
  if relationship_count <> 1 then raise exception 'parent-child catalogue relationship was not created'; end if;
end $$;

\echo 'catalogue integrity: replay the record idempotently'
create temporary table replay_import as
select * from public.upsert_open_catalogue_batch_v1(
  'overture',
  jsonb_build_array(jsonb_build_object(
    'source_place_id','overture-test-cafe','source_release_id','2026-07-23.0',
    'catalogue_region_id',:'test_region_id','normalization_version',2,'category_mapping_version',2,
    'payload_hash',repeat('b',64),'name','Catalogue Integrity Cafe',
    'slug','catalogue-integrity-cafe-a1b2c3d4','kind','cafe','category_confidence',0.98,
    'summary','A cafe in Oakville. Opening hours and other details are shown only when verified.',
    'city','Oakville','region','Ontario','region_code','ON','country','Canada','country_code','CA',
    'postal_code','L6J 1H4','address_public','123 Lakeshore Road','latitude',43.4791,'longitude',-79.648,
    'timezone','America/Toronto','amenities',jsonb_build_array('coffee','wifi'),
    'accessibility',jsonb_build_object('wheelchair_accessible',true),
    'opening_hours',jsonb_build_object('monday','08:00-18:00'),'price_level',2,
    'brand_id','catalogue-coffee','brand_name','Catalogue Coffee',
    'duplicate_group_key','catalogue-integrity-cafe|123-lakeshore|43.4791:-79.6480',
    'catalogue_group_key','overture:overture-test-cafe'
  ))
);

do $$
declare
  replayed record;
  linked_count integer;
begin
  select * into replayed from replay_import limit 1;
  if replayed.error_message is not null then raise exception 'idempotent catalogue replay failed: %', replayed.error_message; end if;
  select count(*) into linked_count from public.location_source_links
  where source='overture' and source_place_id='overture-test-cafe';
  if linked_count <> 1 then raise exception 'replay created % source links instead of one', linked_count; end if;
end $$;

\echo 'catalogue integrity: isolate invalid records inside a mixed batch'
create temporary table mixed_import as
select * from public.upsert_open_catalogue_batch_v1(
  'overture',
  jsonb_build_array(
    jsonb_build_object(
      'source_place_id','overture-test-second','payload_hash',repeat('c',64),
      'name','Second Catalogue Cafe','slug','second-catalogue-cafe-a1b2c3d4','kind','cafe',
      'summary','A cafe in Oakville. Opening hours and other details are shown only when verified.',
      'city','Oakville','country_code','CA','latitude',43.48,'longitude',-79.65,
      'timezone','America/Toronto','amenities','[]'::jsonb
    ),
    jsonb_build_object(
      'source_place_id','overture-test-invalid','name','Invalid Coordinates',
      'slug','invalid-coordinates-a1b2c3d4','kind','cafe','city','Oakville',
      'latitude',999,'longitude',-79.65,'amenities','[]'::jsonb
    ),
    jsonb_build_object(
      'source_place_id','overture-test-missing-coordinates','name','Missing Coordinates',
      'slug','missing-coordinates-a1b2c3d4','kind','cafe','city','Oakville','amenities','[]'::jsonb
    )
  )
);

do $$
declare
  successes integer;
  failures integer;
  invalid_links integer;
begin
  select count(*) filter(where error_message is null),count(*) filter(where error_message is not null)
    into successes,failures from mixed_import;
  if successes <> 1 or failures <> 2 then
    raise exception 'mixed batch expected 1 success and 2 failures, found % and %', successes,failures;
  end if;
  select count(*) into invalid_links from public.location_source_links
  where source='overture' and source_place_id in ('overture-test-invalid','overture-test-missing-coordinates');
  if invalid_links <> 0 then raise exception 'invalid records left % source links', invalid_links; end if;
end $$;

\echo 'catalogue integrity: claim photo work without starving later rows'
create temporary table photo_claim as
select * from public.claim_open_photo_candidates_v1(20,:'test_region_id');

do $$
declare
  claimed_count integer;
  target uuid;
begin
  select count(*) into claimed_count from photo_claim;
  if claimed_count < 2 then raise exception 'expected regional photo candidates, found %', claimed_count; end if;
  select id into target from photo_claim limit 1;
  perform public.complete_open_photo_candidate_v1(target,'no_match',null);
  if not exists(
    select 1 from public.locations where id=target and photo_enrichment_status='no_match'
      and photo_retry_after>now()+interval '80 days'
  ) then raise exception 'photo no-match retry state was not stored'; end if;
end $$;

\echo 'catalogue integrity: reconcile missed releases without immediate deletion'
select public.finalize_catalogue_region_refresh_v1(:'test_region_id','overture');
select public.begin_catalogue_region_refresh_v1(:'test_region_id','overture','2026-08-01.0');
select public.finalize_catalogue_region_refresh_v1(:'test_region_id','overture');

do $$
declare
  missed integer;
  still_published integer;
begin
  select missed_refreshes into missed from public.catalogue_region_locations
  where region_id=:'test_region_id' and source='overture' and source_place_id='overture-test-cafe';
  if missed <> 1 then raise exception 'expected one missed refresh, found %', missed; end if;
  select count(*) into still_published from public.locations l
  join public.location_source_links s on s.location_id=l.id
  where s.source='overture' and s.source_place_id='overture-test-cafe' and l.status='published';
  if still_published <> 1 then raise exception 'one missed refresh archived the location too early'; end if;
end $$;

rollback;
