\set ON_ERROR_STOP on
begin;

\echo 'catalogue integrity: private worker RPC permissions'
select case when has_function_privilege(
  'service_role','public.upsert_open_catalogue_batch_v1(text,jsonb)','EXECUTE'
) then 1 else 1/(floor(random())::int) end as service_role_can_import;
select case when not has_function_privilege(
  'authenticated','public.upsert_open_catalogue_batch_v1(text,jsonb)','EXECUTE'
) then 1 else 1/(floor(random())::int) end as authenticated_cannot_import;
select case when has_function_privilege(
  'service_role','public.claim_open_photo_candidates_v1(integer,uuid)','EXECUTE'
) then 1 else 1/(floor(random())::int) end as service_role_can_claim_photos;

insert into public.catalogue_sync_regions(
  region_key,center_latitude,center_longitude,radius_km,source,status
) values (
  'catalogue-integrity-region',43.4791,-79.648,25,'overture','processing'
) returning id as test_region_id \gset

select public.begin_catalogue_region_refresh_v1(:'test_region_id','overture','2026-07-23.0');

\echo 'catalogue integrity: rich parent and child records are atomic and linked'
create temporary table rich_import as
select * from public.upsert_open_catalogue_batch_v1(
  'overture',
  jsonb_build_array(
    jsonb_build_object(
      'source_place_id','overture-test-cafe','source_updated_at','2026-06-17T00:00:00Z',
      'source_confidence',0.97,'source_operating_status','open',
      'source_release_id','2026-07-23.0','catalogue_region_id',:'test_region_id',
      'normalization_version',2,'category_mapping_version',2,
      'source_metadata',jsonb_build_object('source_categories',jsonb_build_object('primary',jsonb_build_array('coffee_shop'))),
      'payload_hash',repeat('a',64),'name','Catalogue Integrity Cafe',
      'slug','catalogue-integrity-cafe-a1b2c3d4','kind','cafe','category_confidence',0.98,
      'summary','A cafe in Oakville. Opening hours and other details are shown only when verified.',
      'city','Oakville','region','Ontario','region_code','ON','country','Canada','country_code','CA',
      'postal_code','L6J 1H4','address_public','123 Lakeshore Road',
      'latitude',43.4791,'longitude',-79.648,'timezone','America/Toronto',
      'amenities',jsonb_build_array('coffee','wifi'),
      'accessibility',jsonb_build_object('wheelchair_accessible',true),
      'opening_hours',jsonb_build_object('monday','08:00-18:00'),'price_level',2,
      'website_url','https://example.com/catalogue-cafe','phone_public','+1 905 555 0100',
      'brand_id','catalogue-coffee','brand_name','Catalogue Coffee',
      'duplicate_group_key','catalogue-integrity-cafe|123-lakeshore|43.4791:-79.6480',
      'catalogue_group_key','overture:overture-test-cafe'
    ),
    jsonb_build_object(
      'source_place_id','overture-test-playground','source_parent_place_id','overture-test-cafe',
      'source_release_id','2026-07-23.0','catalogue_region_id',:'test_region_id',
      'normalization_version',2,'category_mapping_version',2,'payload_hash',repeat('d',64),
      'name','Catalogue Integrity Playground','slug','catalogue-integrity-playground-a1b2c3d4',
      'kind','park','category_confidence',0.90,
      'summary','A playground in Oakville. Opening hours and other details are shown only when verified.',
      'city','Oakville','region','Ontario','region_code','ON','country','Canada','country_code','CA',
      'latitude',43.4792,'longitude',-79.6481,'timezone','America/Toronto',
      'amenities','[]'::jsonb,'accessibility','{}'::jsonb,'opening_hours','{}'::jsonb,
      'duplicate_group_key','catalogue-integrity-playground',
      'catalogue_group_key','overture:overture-test-cafe'
    )
  )
);

select case when count(*)=2 and bool_and(location_id is not null and error_message is null)
  then 1 else 1/(floor(random())::int) end as rich_batch_succeeded from rich_import;

select case when count(*)=1 then 1 else 1/(floor(random())::int) end as rich_geography_stored
from public.locations l
join public.location_source_links s on s.location_id=l.id
where s.source='overture' and s.source_place_id='overture-test-cafe'
  and s.source_release_id='2026-07-23.0' and s.normalization_version=2
  and s.category_mapping_version=2 and l.status='published' and l.source='import'
  and l.city='Oakville' and l.region='Ontario' and l.region_code='ON'
  and l.country='Canada' and l.country_code='CA' and l.postal_code='L6J 1H4'
  and l.timezone='America/Toronto' and l.timezone_verified
  and l.brand_id='catalogue-coffee' and l.brand_name='Catalogue Coffee'
  and l.category_confidence=0.98 and l.normalization_version=2 and l.category_mapping_version=2
  and l.opening_hours->>'monday'='08:00-18:00'
  and l.accessibility->>'wheelchair_accessible'='true';

select case when count(*)=2 and bool_and(present_in_latest_release)
  then 1 else 1/(floor(random())::int) end as region_membership_stored
from public.catalogue_region_locations
where region_id=:'test_region_id' and source='overture'
  and source_place_id in ('overture-test-cafe','overture-test-playground');

select case when count(*)=1 then 1 else 1/(floor(random())::int) end as parent_child_linked
from public.locations child
join public.location_source_links child_link on child_link.location_id=child.id
join public.location_source_links parent_link on parent_link.location_id=child.parent_location_id
where child_link.source='overture' and child_link.source_place_id='overture-test-playground'
  and parent_link.source='overture' and parent_link.source_place_id='overture-test-cafe'
  and child.catalogue_group_key='overture:overture-test-cafe';

select case when count(*)=2 then 1 else 1/(floor(random())::int) end as generated_descriptions_stored
from public.location_descriptions description
join public.location_source_links source_link on source_link.location_id=description.location_id
where source_link.source='overture'
  and source_link.source_place_id in ('overture-test-cafe','overture-test-playground')
  and description.source='generated_factual' and description.status='approved';

\echo 'catalogue integrity: replay remains idempotent'
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
select case when count(*)=1 then 1 else 1/(floor(random())::int) end as replay_kept_one_source_link
from public.location_source_links
where source='overture' and source_place_id='overture-test-cafe';

\echo 'catalogue integrity: invalid rows roll back independently'
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
select case when count(*) filter(where error_message is null)=1
                  and count(*) filter(where error_message is not null)=2
  then 1 else 1/(floor(random())::int) end as mixed_batch_isolated_failures
from mixed_import;
select case when count(*)=0 then 1 else 1/(floor(random())::int) end as invalid_rows_left_no_links
from public.location_source_links
where source='overture'
  and source_place_id in ('overture-test-invalid','overture-test-missing-coordinates');

\echo 'catalogue integrity: progressive regional photo queue'
create temporary table photo_claim as
select * from public.claim_open_photo_candidates_v1(20,:'test_region_id');
select case when count(*)>=2 then 1 else 1/(floor(random())::int) end as regional_photo_candidates_claimed
from photo_claim;
select id as claimed_photo_location from photo_claim limit 1 \gset
select public.complete_open_photo_candidate_v1(:'claimed_photo_location','no_match',null);
select case when count(*)=1 then 1 else 1/(floor(random())::int) end as no_match_retry_recorded
from public.locations
where id=:'claimed_photo_location' and photo_enrichment_status='no_match'
  and photo_retry_after>now()+interval '80 days';

\echo 'catalogue integrity: missed releases do not archive immediately'
select public.finalize_catalogue_region_refresh_v1(:'test_region_id','overture');
select public.begin_catalogue_region_refresh_v1(:'test_region_id','overture','2026-08-01.0');
select public.finalize_catalogue_region_refresh_v1(:'test_region_id','overture');
select case when missed_refreshes=1 then 1 else 1/(floor(random())::int) end as one_missed_release_recorded
from public.catalogue_region_locations
where region_id=:'test_region_id' and source='overture' and source_place_id='overture-test-cafe';
select case when count(*)=1 then 1 else 1/(floor(random())::int) end as one_miss_kept_location_published
from public.locations l
join public.location_source_links s on s.location_id=l.id
where s.source='overture' and s.source_place_id='overture-test-cafe' and l.status='published';

rollback;