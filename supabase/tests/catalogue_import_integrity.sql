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
end $$;

\echo 'catalogue integrity: import one current-style record'
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

do $$
declare
  imported record;
begin
  select * into imported from first_import limit 1;
  if imported is null then
    raise exception 'catalogue batch returned no result';
  end if;
  if imported.error_message is not null then
    raise exception 'valid catalogue import failed: %', imported.error_message;
  end if;
  if imported.location_id is null then
    raise exception 'valid catalogue import returned no location ID';
  end if;
end $$;

do $$
declare
  linked_count integer;
  description_count integer;
  canonical_count integer;
begin
  select count(*) into linked_count
  from public.location_source_links
  where source='overture' and source_place_id='overture-test-cafe';
  if linked_count <> 1 then raise exception 'expected one source link, found %', linked_count; end if;

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
end $$;

\echo 'catalogue integrity: replay the record idempotently'
create temporary table replay_import as
select * from public.upsert_open_catalogue_batch_v1(
  'overture',
  jsonb_build_array(jsonb_build_object(
    'source_place_id','overture-test-cafe',
    'payload_hash',repeat('b',64),
    'name','Catalogue Integrity Cafe',
    'slug','catalogue-integrity-cafe-a1b2c3d4',
    'kind','cafe',
    'summary','A cafe in Oakville. Opening hours and other details are shown only when verified.',
    'city','Oakville','country_code','CA','latitude',43.4791,'longitude',-79.648,
    'timezone','America/Toronto','amenities','[]'::jsonb
  ))
);

do $$
declare
  replayed record;
  linked_count integer;
begin
  select * into replayed from replay_import limit 1;
  if replayed.error_message is not null then
    raise exception 'idempotent catalogue replay failed: %', replayed.error_message;
  end if;
  select count(*) into linked_count
  from public.location_source_links
  where source='overture' and source_place_id='overture-test-cafe';
  if linked_count <> 1 then raise exception 'replay created % source links instead of one', linked_count; end if;
end $$;

\echo 'catalogue integrity: isolate an invalid record inside a mixed batch'
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
  select count(*) filter(where error_message is null),
         count(*) filter(where error_message is not null)
    into successes,failures
  from mixed_import;
  if successes <> 1 or failures <> 2 then
    raise exception 'mixed batch expected 1 success and 2 failures, found % and %', successes,failures;
  end if;

  select count(*) into invalid_links
  from public.location_source_links
  where source='overture'
    and source_place_id in ('overture-test-invalid','overture-test-missing-coordinates');
  if invalid_links <> 0 then raise exception 'invalid records left % source links', invalid_links; end if;
end $$;

rollback;
