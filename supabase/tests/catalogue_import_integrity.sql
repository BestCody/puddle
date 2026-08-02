\set ON_ERROR_STOP on
begin;

select case
  when has_function_privilege('service_role','public.upsert_open_catalogue_batch_v1(text,jsonb)','EXECUTE') then 1
  else 1/0
end as service_role_can_import;
select case
  when not has_function_privilege('authenticated','public.upsert_open_catalogue_batch_v1(text,jsonb)','EXECUTE') then 1
  else 1/0
end as authenticated_cannot_import;

insert into public.locations(
  name,slug,kind,summary,city,address_public,latitude,longitude,timezone,
  status,visibility,has_private_address,source
) values (
  'Catalogue Integrity Cafe','catalogue-integrity-cafe-existing','cafe','Existing import row for integrity testing.',
  'Oakville','123 Lakeshore Road',43.4791,-79.648,'America/Toronto',
  'draft','public',false,'import'
);

create temporary table first_import as
select * from public.upsert_open_catalogue_batch_v1(
  'overture',
  jsonb_build_array(jsonb_build_object(
    'source_place_id','overture-test-cafe',
    'source_updated_at','2026-06-17T00:00:00Z',
    'source_confidence',0.97,
    'payload_hash',repeat('a',64),
    'name','Catalogue Integrity Cafe',
    'slug','catalogue-integrity-cafe-a1b2c3d4',
    'kind','cafe',
    'summary','A cafe in Oakville. Opening hours and other details are shown only when verified.',
    'city','Oakville',
    'region','Ontario',
    'country','Canada',
    'country_code','CA',
    'address_public','123 Lakeshore Road',
    'latitude',43.4791,
    'longitude',-79.648,
    'timezone','America/Toronto',
    'amenities',jsonb_build_array('coffee','wifi')
  ))
);

select case when count(*)=1 and bool_and(location_id is not null and error_message is null) then 1 else 1/0 end
from first_import;
select case when count(*)=1 then 1 else 1/0 end
from public.location_source_links
where source='overture' and source_place_id='overture-test-cafe';
select case when count(*)=1 then 1 else 1/0 end
from public.location_descriptions d
join public.location_source_links s on s.location_id=d.location_id
where s.source='overture' and s.source_place_id='overture-test-cafe'
  and d.source='generated_factual' and d.status='approved';
select case when count(*)=1 and bool_and(status='published') then 1 else 1/0 end
from public.locations
where slug='catalogue-integrity-cafe-existing';

-- Replaying the same source record must remain idempotent.
select * from public.upsert_open_catalogue_batch_v1(
  'overture',
  jsonb_build_array(jsonb_build_object(
    'source_place_id','overture-test-cafe',
    'payload_hash',repeat('b',64),
    'name','Catalogue Integrity Cafe',
    'slug','catalogue-integrity-cafe-a1b2c3d4',
    'kind','cafe',
    'summary','A cafe in Oakville. Opening hours and other details are shown only when verified.',
    'city','Oakville',
    'country_code','CA',
    'latitude',43.4791,
    'longitude',-79.648,
    'timezone','America/Toronto',
    'amenities','[]'::jsonb
  ))
);
select case when count(*)=1 then 1 else 1/0 end
from public.location_source_links
where source='overture' and source_place_id='overture-test-cafe';

-- One invalid record must be rolled back without undoing a valid record in the batch.
create temporary table mixed_import as
select * from public.upsert_open_catalogue_batch_v1(
  'overture',
  jsonb_build_array(
    jsonb_build_object(
      'source_place_id','overture-test-second',
      'payload_hash',repeat('c',64),
      'name','Second Catalogue Cafe',
      'slug','second-catalogue-cafe-a1b2c3d4',
      'kind','cafe',
      'summary','A cafe in Oakville. Opening hours and other details are shown only when verified.',
      'city','Oakville','country_code','CA','latitude',43.48,'longitude',-79.65,
      'timezone','America/Toronto','amenities','[]'::jsonb
    ),
    jsonb_build_object(
      'source_place_id','overture-test-invalid',
      'name','Invalid Coordinates',
      'slug','invalid-coordinates-a1b2c3d4',
      'kind','cafe','city','Oakville','latitude',999,'longitude',-79.65,
      'amenities','[]'::jsonb
    )
  )
);
select case when count(*) filter(where error_message is null)=1
                  and count(*) filter(where error_message is not null)=1
            then 1 else 1/0 end
from mixed_import;
select case when count(*)=0 then 1 else 1/0 end
from public.location_source_links
where source='overture' and source_place_id='overture-test-invalid';

rollback;
