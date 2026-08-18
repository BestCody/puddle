\set ON_ERROR_STOP on
begin;

\echo 'location architecture: canonical Supabase catalogue is absent'
do $$
begin
  if to_regclass('public.locations') is not null then raise exception 'public.locations must not exist'; end if;
  if to_regclass('public.location_refs') is null then raise exception 'public.location_refs is missing'; end if;
  if to_regclass('public.location_submissions') is null then raise exception 'public.location_submissions is missing'; end if;
  if to_regclass('public.location_host_links') is null then raise exception 'public.location_host_links is missing'; end if;
  if to_regclass('public.location_moderation_overrides') is null then raise exception 'public.location_moderation_overrides is missing'; end if;
end $$;

\echo 'location architecture: lazy refs contain IDs, not catalogue metadata'
do $$
declare forbidden text;
begin
  select string_agg(column_name,', ' order by column_name) into forbidden
  from information_schema.columns
  where table_schema='public' and table_name='location_refs'
    and column_name in ('name','slug','summary','description','kind_name','city','region','country','latitude','longitude','address_public','cover_path','opening_hours','amenities','price_level','google_place_id');
  if forbidden is not null then raise exception 'location_refs contains catalogue fields: %',forbidden; end if;
end $$;

\echo 'location architecture: retired catalogue/enrichment tables are absent'
do $$
declare found text;
begin
  select string_agg(name,', ' order by name) into found from (values
    ('catalogue_region_locations'),('catalogue_sync_regions'),('google_place_geocode_attempts'),
    ('google_place_id_candidates'),('google_place_match_attempts'),('location_descriptions'),
    ('location_google_places'),('location_photo_sources'),('location_source_links')
  ) retired(name) where to_regclass('public.'||name) is not null;
  if found is not null then raise exception 'retired location tables still exist: %',found; end if;
end $$;

\echo 'location architecture: Google Places quota ledger is preserved'
do $$
begin
  if to_regclass('public.google_places_sku_monthly_usage') is null then
    raise exception 'google_places_sku_monthly_usage must survive catalogue cleanup';
  end if;
end $$;

\echo 'location architecture: no installed function references the retired locations table'
do $$
declare found text;
begin
  select string_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',E'\n' order by p.proname)
  into found
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind in ('f','p')
    and lower(pg_get_functiondef(p.oid)) ~ '(^|[^a-z_])locations([^a-z_]|$)';
  if found is not null then raise exception 'functions still reference retired locations table:%',E'\n'||found; end if;
end $$;

\echo 'location architecture: retired catalogue RPCs are absent'
do $$
declare found text;
begin
  select string_agg(p.proname,', ' order by p.proname) into found
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (
    'catalogue_quality_review_v1','claim_google_place_candidates_v3','claim_google_place_discovery_candidates_v1',
    'claim_google_place_geocode_candidates_v1','claim_open_photo_candidates_v1','complete_open_photo_candidate_v1',
    'content_in_view_v1','discover_candidates_v1','discovery_spatial_profile_v1','finalize_catalogue_region_refresh_v1',
    'find_open_location_match_v1','find_open_location_match_v2','r2_discovery_overlay_v2','upsert_open_catalogue_location_v1',
    'recommendation_candidate_pool_v1','recommendation_context_base_v1','recommendation_preference_text_base_v1',
    'recommendation_preference_text_v1','record_recommendation_outcome_v1','claim_embedding_jobs_v1','queue_embedding_regeneration_v1',
    'record_discovery_actions_v3','pass_location_heatmap_v1','update_location_point_v1'
  );
  if found is not null then raise exception 'retired location RPCs still exist: %',found; end if;
end $$;

\echo 'location architecture: relational location FKs target lazy refs or submissions'
do $$
declare invalid text;
begin
  select string_agg(con.conname,', ' order by con.conname) into invalid
  from pg_constraint con
  join pg_class source on source.oid=con.conrelid
  join pg_namespace ns on ns.oid=source.relnamespace
  join pg_class target on target.oid=con.confrelid
  where con.contype='f' and ns.nspname='public'
    and source.relname not in ('location_private_details','location_revisions')
    and target.relname='location_submissions';
  if invalid is not null then raise exception 'product FKs unexpectedly target submissions: %',invalid; end if;
end $$;

\echo 'location architecture: sparse overlay permissions'
select case when has_table_privilege('authenticated','public.location_moderation_overrides','SELECT')
  then 1 else 1/(floor(random())::int) end as authenticated_can_read_moderation_state;
select case when not has_table_privilege('authenticated','public.location_refs','INSERT')
  then 1 else 1/(floor(random())::int) end as authenticated_cannot_allocate_refs_directly;
select case when has_table_privilege('service_role','public.location_refs','INSERT')
  then 1 else 1/(floor(random())::int) end as service_role_can_allocate_refs;

rollback;
