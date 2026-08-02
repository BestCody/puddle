-- Catalogue quality v2: normalized geography, richer source metadata, region membership,
-- safe reconciliation, progressive photo enrichment, and reviewable quality signals.

alter table public.locations add column if not exists region_code text;
alter table public.locations add column if not exists postal_code text;
alter table public.locations add column if not exists website_url text;
alter table public.locations add column if not exists phone_public text;
alter table public.locations add column if not exists brand_id text;
alter table public.locations add column if not exists brand_name text;
alter table public.locations add column if not exists source_parent_place_id text;
alter table public.locations add column if not exists parent_location_id uuid references public.locations(id) on delete set null;
alter table public.locations add column if not exists duplicate_group_key text;
alter table public.locations add column if not exists catalogue_group_key text;
alter table public.locations add column if not exists category_confidence numeric(6,5);
alter table public.locations add column if not exists normalization_version integer;
alter table public.locations add column if not exists category_mapping_version integer;
alter table public.locations add column if not exists source_operating_status text;
alter table public.locations add column if not exists source_metadata jsonb not null default '{}'::jsonb;
alter table public.locations add column if not exists timezone_verified boolean not null default false;
alter table public.locations add column if not exists timezone_source text;
alter table public.locations add column if not exists photo_enrichment_status text not null default 'pending';
alter table public.locations add column if not exists photo_last_attempt_at timestamptz;
alter table public.locations add column if not exists photo_retry_after timestamptz;
alter table public.locations add column if not exists photo_attempts integer not null default 0;
alter table public.locations add column if not exists photo_error_message text;

alter table public.location_source_links add column if not exists source_parent_place_id text;
alter table public.location_source_links add column if not exists source_brand_id text;
alter table public.location_source_links add column if not exists source_release_id text;
alter table public.location_source_links add column if not exists source_operating_status text;
alter table public.location_source_links add column if not exists normalization_version integer;
alter table public.location_source_links add column if not exists category_mapping_version integer;
alter table public.location_source_links add column if not exists source_metadata jsonb not null default '{}'::jsonb;
alter table public.location_source_links add column if not exists missed_refreshes integer not null default 0;
alter table public.location_source_links add column if not exists stale_since timestamptz;

alter table public.catalogue_sync_regions add column if not exists downloaded_count integer not null default 0;
alter table public.catalogue_sync_regions add column if not exists read_count integer not null default 0;
alter table public.catalogue_sync_regions add column if not exists accepted_count integer not null default 0;
alter table public.catalogue_sync_regions add column if not exists rejected_count integer not null default 0;
alter table public.catalogue_sync_regions add column if not exists failed_count integer not null default 0;
alter table public.catalogue_sync_regions add column if not exists truncated boolean not null default false;
alter table public.catalogue_sync_regions add column if not exists rejection_reasons jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='locations_region_code_format') then
    alter table public.locations add constraint locations_region_code_format
      check(region_code is null or region_code ~ '^[A-Z0-9-]{1,8}$');
  end if;
  if not exists(select 1 from pg_constraint where conname='locations_category_confidence_range') then
    alter table public.locations add constraint locations_category_confidence_range
      check(category_confidence is null or category_confidence between 0 and 1);
  end if;
  if not exists(select 1 from pg_constraint where conname='locations_photo_enrichment_status_values') then
    alter table public.locations add constraint locations_photo_enrichment_status_values
      check(photo_enrichment_status in ('pending','processing','matched','no_match','failed','skipped'));
  end if;
  if not exists(select 1 from pg_constraint where conname='locations_photo_attempts_nonnegative') then
    alter table public.locations add constraint locations_photo_attempts_nonnegative check(photo_attempts>=0);
  end if;
  if not exists(select 1 from pg_constraint where conname='locations_parent_not_self') then
    alter table public.locations add constraint locations_parent_not_self check(parent_location_id is null or parent_location_id<>id);
  end if;
end $$;

create index if not exists locations_country_region_idx on public.locations(country_code,region_code,city);
create index if not exists locations_brand_idx on public.locations(brand_id) where brand_id is not null;
create index if not exists locations_parent_idx on public.locations(parent_location_id) where parent_location_id is not null;
create index if not exists locations_duplicate_group_idx on public.locations(duplicate_group_key) where duplicate_group_key is not null;
create index if not exists locations_catalogue_group_idx on public.locations(catalogue_group_key) where catalogue_group_key is not null;
create index if not exists locations_photo_enrichment_idx
  on public.locations(photo_enrichment_status,photo_retry_after,photo_attempts,published_at)
  where status='published' and visibility='public';
create index if not exists location_source_links_parent_idx
  on public.location_source_links(source,source_parent_place_id) where source_parent_place_id is not null;

create table if not exists public.catalogue_region_locations (
  region_id uuid not null references public.catalogue_sync_regions(id) on delete cascade,
  source text not null check(source in ('overture','fsq_os')),
  source_place_id text not null,
  location_id uuid not null references public.locations(id) on delete cascade,
  release_id text,
  present_in_latest_release boolean not null default true,
  missed_refreshes integer not null default 0 check(missed_refreshes>=0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(region_id,source,source_place_id)
);
create index if not exists catalogue_region_locations_location_idx
  on public.catalogue_region_locations(location_id,region_id);
create index if not exists catalogue_region_locations_reconcile_idx
  on public.catalogue_region_locations(region_id,present_in_latest_release,missed_refreshes);
alter table public.catalogue_region_locations enable row level security;

create or replace function public.find_open_location_match_v2(
  target_name text,
  target_kind text,
  target_latitude double precision,
  target_longitude double precision,
  target_city text,
  target_country_code text,
  target_address text
)
returns uuid
language sql
stable
security definer
set search_path=public
as $$
  select l.id
  from public.locations l
  where l.status not in ('rejected','suspended','archived')
    and l.latitude is not null and l.longitude is not null
    and coalesce(l.has_private_address,false)=false
    and l.visibility in ('public','unlisted')
    and abs(l.latitude-target_latitude)<=0.00035
    and abs(l.longitude-target_longitude)<=0.00035
    and (target_country_code is null or l.country_code is null or l.country_code=target_country_code)
    and (target_city is null or l.city is null or lower(l.city)=lower(target_city))
    and (l.kind=target_kind or l.kind='other' or target_kind='other')
    and regexp_replace(lower(l.name),'[^a-z0-9]+','','g')=
        regexp_replace(lower(target_name),'[^a-z0-9]+','','g')
    and (
      target_address is null or l.address_public is null
      or regexp_replace(lower(l.address_public),'[^a-z0-9]+','','g')=
         regexp_replace(lower(target_address),'[^a-z0-9]+','','g')
    )
  order by abs(l.latitude-target_latitude)+abs(l.longitude-target_longitude)
  limit 1;
$$;

create or replace function public.upsert_open_catalogue_location_v1(
  import_source text,
  payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  source_id text:=nullif(trim(payload->>'source_place_id'),'');
  source_parent_id text:=nullif(trim(payload->>'source_parent_place_id'),'');
  place_name text:=nullif(trim(payload->>'name'),'');
  place_slug text:=nullif(trim(payload->>'slug'),'');
  place_kind text:=nullif(trim(payload->>'kind'),'');
  place_city text:=coalesce(
    nullif(trim(payload->>'city'),''),nullif(trim(payload->>'region'),''),
    nullif(trim(payload->>'country'),''),'Unspecified locality'
  );
  place_latitude double precision;
  place_longitude double precision;
  place_confidence numeric;
  place_category_confidence numeric;
  place_source_updated_at timestamptz;
  place_amenities text[]:='{}'::text[];
  place_accessibility jsonb:='{}'::jsonb;
  place_opening_hours jsonb:='{}'::jsonb;
  place_source_metadata jsonb:='{}'::jsonb;
  place_price_level smallint;
  region_value uuid;
  location_id_value uuid;
  location_source_value text;
  parent_id_value uuid;
  timezone_value text:=coalesce(nullif(trim(payload->>'timezone'),''),'UTC');
  timezone_is_verified boolean:=nullif(trim(payload->>'timezone'),'') is not null;
begin
  if import_source not in ('fsq_os','overture') then raise exception 'unsupported catalogue source'; end if;
  if source_id is null or char_length(source_id)>240 then raise exception 'invalid source place id'; end if;
  if place_name is null or char_length(place_name) not between 2 and 120 then raise exception 'invalid place name'; end if;
  if place_slug is null or place_slug !~ '^[a-z0-9-]{3,100}$' then raise exception 'invalid place slug'; end if;
  if place_kind not in (
    'cafe','restaurant','bar','park','museum','gallery','attraction','activity_venue',
    'study_spot','scenic_spot','nightlife','shop','community_space','other'
  ) then raise exception 'invalid place kind'; end if;

  place_latitude:=(payload->>'latitude')::double precision;
  place_longitude:=(payload->>'longitude')::double precision;
  if place_latitude not between -90 and 90 or place_longitude not between -180 and 180 then
    raise exception 'invalid place coordinates';
  end if;

  if nullif(payload->>'source_confidence','') is not null then
    place_confidence:=(payload->>'source_confidence')::numeric;
    if place_confidence not between 0 and 1 then raise exception 'invalid source confidence'; end if;
  end if;
  if nullif(payload->>'category_confidence','') is not null then
    place_category_confidence:=(payload->>'category_confidence')::numeric;
    if place_category_confidence not between 0 and 1 then raise exception 'invalid category confidence'; end if;
  end if;
  if nullif(payload->>'source_updated_at','') is not null then
    place_source_updated_at:=(payload->>'source_updated_at')::timestamptz;
  end if;
  if nullif(payload->>'price_level','') is not null then
    place_price_level:=(payload->>'price_level')::smallint;
    if place_price_level not between 1 and 4 then raise exception 'invalid price level'; end if;
  end if;
  if nullif(payload->>'catalogue_region_id','') is not null then
    region_value:=(payload->>'catalogue_region_id')::uuid;
  end if;
  if jsonb_typeof(coalesce(payload->'amenities','[]'::jsonb))='array' then
    select coalesce(array_agg(left(value,50)) filter(where nullif(trim(value),'') is not null),'{}'::text[])
      into place_amenities
    from jsonb_array_elements_text(coalesce(payload->'amenities','[]'::jsonb));
  end if;
  if jsonb_typeof(coalesce(payload->'accessibility','{}'::jsonb))='object' then
    place_accessibility:=coalesce(payload->'accessibility','{}'::jsonb);
  end if;
  if jsonb_typeof(coalesce(payload->'opening_hours','{}'::jsonb))='object' then
    place_opening_hours:=coalesce(payload->'opening_hours','{}'::jsonb);
  end if;
  if jsonb_typeof(coalesce(payload->'source_metadata','{}'::jsonb))='object' then
    place_source_metadata:=coalesce(payload->'source_metadata','{}'::jsonb);
  end if;

  select l.location_id into location_id_value
  from public.location_source_links l
  where l.source=import_source and l.source_place_id=source_id;

  if location_id_value is null then
    location_id_value:=public.find_open_location_match_v2(
      place_name,place_kind,place_latitude,place_longitude,place_city,
      nullif(trim(payload->>'country_code'),''),nullif(trim(payload->>'address_public'),'')
    );
  end if;

  if source_parent_id is not null then
    select l.location_id into parent_id_value
    from public.location_source_links l
    where l.source=import_source and l.source_place_id=source_parent_id;
  end if;

  if location_id_value is null then
    insert into public.locations(
      name,slug,kind,summary,city,neighborhood,region,region_code,country,country_code,
      postal_code,address_public,latitude,longitude,timezone,timezone_verified,timezone_source,
      amenities,accessibility,opening_hours,price_level,website_url,phone_public,
      brand_id,brand_name,source_parent_place_id,parent_location_id,duplicate_group_key,
      catalogue_group_key,category_confidence,normalization_version,category_mapping_version,
      source_operating_status,source_metadata,status,visibility,has_private_address,source,
      photo_enrichment_status,published_at
    ) values (
      place_name,place_slug,place_kind,nullif(trim(payload->>'summary'),''),place_city,
      nullif(trim(payload->>'neighborhood'),''),nullif(trim(payload->>'region'),''),
      nullif(trim(payload->>'region_code'),''),nullif(trim(payload->>'country'),''),
      nullif(trim(payload->>'country_code'),''),nullif(trim(payload->>'postal_code'),''),
      nullif(trim(payload->>'address_public'),''),place_latitude,place_longitude,timezone_value,
      timezone_is_verified,case when timezone_is_verified then import_source else null end,
      place_amenities,place_accessibility,place_opening_hours,place_price_level,
      nullif(trim(payload->>'website_url'),''),nullif(trim(payload->>'phone_public'),''),
      nullif(trim(payload->>'brand_id'),''),nullif(trim(payload->>'brand_name'),''),source_parent_id,
      parent_id_value,nullif(trim(payload->>'duplicate_group_key'),''),
      nullif(trim(payload->>'catalogue_group_key'),''),place_category_confidence,
      nullif(payload->>'normalization_version','')::integer,
      nullif(payload->>'category_mapping_version','')::integer,
      nullif(trim(payload->>'source_operating_status'),''),place_source_metadata,
      'published','public',false,'import','pending',now()
    ) returning id into location_id_value;
  else
    select source into location_source_value from public.locations where id=location_id_value for update;
    if location_source_value='import' then
      perform set_config('puddle.allow_status_transition','on',true);
      perform set_config('puddle.change_source','update',true);
      update public.locations set
        name=place_name,kind=place_kind,summary=nullif(trim(payload->>'summary'),''),city=place_city,
        neighborhood=nullif(trim(payload->>'neighborhood'),''),region=nullif(trim(payload->>'region'),''),
        region_code=nullif(trim(payload->>'region_code'),''),country=nullif(trim(payload->>'country'),''),
        country_code=nullif(trim(payload->>'country_code'),''),postal_code=nullif(trim(payload->>'postal_code'),''),
        address_public=nullif(trim(payload->>'address_public'),''),latitude=place_latitude,longitude=place_longitude,
        timezone=timezone_value,timezone_verified=timezone_is_verified,
        timezone_source=case when timezone_is_verified then import_source else null end,
        amenities=place_amenities,accessibility=place_accessibility,opening_hours=place_opening_hours,
        price_level=place_price_level,website_url=nullif(trim(payload->>'website_url'),''),
        phone_public=nullif(trim(payload->>'phone_public'),''),brand_id=nullif(trim(payload->>'brand_id'),''),
        brand_name=nullif(trim(payload->>'brand_name'),''),source_parent_place_id=source_parent_id,
        parent_location_id=coalesce(parent_id_value,parent_location_id),
        duplicate_group_key=nullif(trim(payload->>'duplicate_group_key'),''),
        catalogue_group_key=nullif(trim(payload->>'catalogue_group_key'),''),
        category_confidence=place_category_confidence,
        normalization_version=nullif(payload->>'normalization_version','')::integer,
        category_mapping_version=nullif(payload->>'category_mapping_version','')::integer,
        source_operating_status=nullif(trim(payload->>'source_operating_status'),''),
        source_metadata=place_source_metadata,status='published',visibility='public',has_private_address=false,
        published_at=coalesce(published_at,now()),updated_at=now()
      where id=location_id_value;
    end if;
  end if;

  insert into public.location_source_links(
    source,source_place_id,location_id,source_confidence,source_updated_at,last_seen_at,
    payload_hash,source_parent_place_id,source_brand_id,source_release_id,source_operating_status,
    normalization_version,category_mapping_version,source_metadata,missed_refreshes,stale_since,updated_at
  ) values (
    import_source,source_id,location_id_value,place_confidence,place_source_updated_at,now(),
    nullif(trim(payload->>'payload_hash'),''),source_parent_id,nullif(trim(payload->>'brand_id'),''),
    nullif(trim(payload->>'source_release_id'),''),nullif(trim(payload->>'source_operating_status'),''),
    nullif(payload->>'normalization_version','')::integer,
    nullif(payload->>'category_mapping_version','')::integer,place_source_metadata,0,null,now()
  ) on conflict(source,source_place_id) do update set
    location_id=excluded.location_id,source_confidence=excluded.source_confidence,
    source_updated_at=excluded.source_updated_at,last_seen_at=now(),payload_hash=excluded.payload_hash,
    source_parent_place_id=excluded.source_parent_place_id,source_brand_id=excluded.source_brand_id,
    source_release_id=excluded.source_release_id,source_operating_status=excluded.source_operating_status,
    normalization_version=excluded.normalization_version,
    category_mapping_version=excluded.category_mapping_version,source_metadata=excluded.source_metadata,
    missed_refreshes=0,stale_since=null,updated_at=now();

  if region_value is not null then
    insert into public.catalogue_region_locations(
      region_id,source,source_place_id,location_id,release_id,present_in_latest_release,
      missed_refreshes,last_seen_at,updated_at
    ) values (
      region_value,import_source,source_id,location_id_value,nullif(trim(payload->>'source_release_id'),''),
      true,0,now(),now()
    ) on conflict(region_id,source,source_place_id) do update set
      location_id=excluded.location_id,release_id=excluded.release_id,present_in_latest_release=true,
      missed_refreshes=0,last_seen_at=now(),updated_at=now();
  end if;

  if source_parent_id is not null and parent_id_value is not null and parent_id_value<>location_id_value then
    update public.locations set parent_location_id=parent_id_value where id=location_id_value and source='import';
  end if;
  update public.locations child set parent_location_id=location_id_value
  from public.location_source_links link
  where link.location_id=child.id and link.source=import_source
    and link.source_parent_place_id=source_id and child.id<>location_id_value and child.source='import';

  insert into public.location_descriptions(
    location_id,source,description,facts_used,status,verified_at,updated_at
  ) values (
    location_id_value,'generated_factual',
    left(coalesce(nullif(trim(payload->>'summary'),''),'A place in '||place_city||'. Details have not yet been verified.'),500),
    jsonb_build_object(
      'kind',place_kind,'city',place_city,'region',nullif(trim(payload->>'region'),''),
      'region_code',nullif(trim(payload->>'region_code'),''),'country',nullif(trim(payload->>'country'),''),
      'country_code',nullif(trim(payload->>'country_code'),''),'neighborhood',nullif(trim(payload->>'neighborhood'),'')
    ),'approved',now(),now()
  ) on conflict(location_id,source) do update set
    description=excluded.description,facts_used=excluded.facts_used,status='approved',
    verified_at=now(),updated_at=now();

  return location_id_value;
end;
$$;

create or replace function public.begin_catalogue_region_refresh_v1(
  target_region uuid,
  import_source text,
  release_value text
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if import_source not in ('overture','fsq_os') then raise exception 'unsupported catalogue source'; end if;
  update public.catalogue_region_locations
  set present_in_latest_release=false,release_id=left(release_value,80),updated_at=now()
  where region_id=target_region and source=import_source;
end;
$$;

create or replace function public.finalize_catalogue_region_refresh_v1(
  target_region uuid,
  import_source text
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  update public.catalogue_region_locations
  set missed_refreshes=missed_refreshes+1,updated_at=now()
  where region_id=target_region and source=import_source and not present_in_latest_release;

  update public.location_source_links link
  set missed_refreshes=coalesce(link.missed_refreshes,0)+1,
      stale_since=coalesce(link.stale_since,now()),updated_at=now()
  where link.source=import_source
    and exists(
      select 1 from public.catalogue_region_locations membership
      where membership.region_id=target_region and membership.source=import_source
        and membership.source_place_id=link.source_place_id and not membership.present_in_latest_release
    )
    and not exists(
      select 1 from public.catalogue_region_locations current_membership
      where current_membership.source=import_source
        and current_membership.source_place_id=link.source_place_id
        and current_membership.present_in_latest_release
    );

  perform set_config('puddle.allow_status_transition','on',true);
  perform set_config('puddle.change_source','update',true);
  update public.locations location
  set status='archived',updated_at=now()
  where location.source='import' and location.status='published'
    and exists(
      select 1 from public.location_source_links link
      where link.location_id=location.id and link.source=import_source and link.missed_refreshes>=3
    )
    and not exists(
      select 1 from public.catalogue_region_locations membership
      where membership.location_id=location.id and membership.present_in_latest_release
    );
end;
$$;

create or replace function public.claim_open_photo_candidates_v1(
  batch_size integer default 200,
  target_region uuid default null
)
returns table(id uuid,name text,kind text,latitude double precision,longitude double precision)
language plpgsql
security definer
set search_path=public
as $$
begin
  return query
  with candidates as (
    select location.id
    from public.locations location
    where location.status='published' and location.visibility='public'
      and not coalesce(location.has_private_address,false)
      and location.latitude is not null and location.longitude is not null
      and (
        location.photo_enrichment_status in ('pending','failed','no_match')
        or (location.photo_enrichment_status='processing' and location.photo_last_attempt_at<now()-interval '6 hours')
      )
      and (location.photo_retry_after is null or location.photo_retry_after<=now())
      and (target_region is null or exists(
        select 1 from public.catalogue_region_locations membership
        where membership.region_id=target_region and membership.location_id=location.id
          and membership.present_in_latest_release
      ))
      and not exists(
        select 1 from public.location_photo_sources photo
        where photo.location_id=location.id and photo.status='approved'
          and not coalesce(photo.is_ai_generated,false)
      )
    order by location.photo_attempts asc,location.category_confidence desc nulls last,
      location.published_at desc nulls last,location.id
    limit greatest(1,least(batch_size,5000))
    for update skip locked
  ), claimed as (
    update public.locations location
    set photo_enrichment_status='processing',photo_last_attempt_at=now(),
        photo_attempts=location.photo_attempts+1,photo_error_message=null,updated_at=now()
    from candidates where location.id=candidates.id
    returning location.id,location.name,location.kind,location.latitude,location.longitude
  )
  select claimed.id,claimed.name,claimed.kind,claimed.latitude,claimed.longitude from claimed;
end;
$$;

create or replace function public.complete_open_photo_candidate_v1(
  target_location uuid,
  outcome text,
  error_value text default null
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if outcome not in ('matched','no_match','failed','skipped') then raise exception 'invalid photo outcome'; end if;
  update public.locations set
    photo_enrichment_status=outcome,
    photo_retry_after=case outcome
      when 'no_match' then now()+interval '90 days'
      when 'failed' then now()+interval '7 days'
      else null
    end,
    photo_error_message=case when outcome='failed' then left(error_value,500) else null end,
    updated_at=now()
  where id=target_location;
end;
$$;

create or replace function public.catalogue_quality_review_v1(max_rows integer default 200)
returns table(location_id uuid,issue text,details jsonb)
language plpgsql
stable
security definer
set search_path=public
as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'admin required'; end if;
  return query
  select * from (
    select l.id,'missing_country_code'::text,jsonb_build_object('name',l.name,'country',l.country) from public.locations l
      where l.source='import' and l.country_code is null
    union all
    select l.id,'missing_country_name',jsonb_build_object('name',l.name,'country_code',l.country_code) from public.locations l
      where l.source='import' and l.country_code is not null and l.country is null
    union all
    select l.id,'low_category_confidence',jsonb_build_object('name',l.name,'kind',l.kind,'confidence',l.category_confidence) from public.locations l
      where l.source='import' and coalesce(l.category_confidence,0)<0.8
    union all
    select l.id,'timezone_unverified',jsonb_build_object('name',l.name,'timezone',l.timezone) from public.locations l
      where l.source='import' and not l.timezone_verified
    union all
    select l.id,'duplicate_group',jsonb_build_object('name',l.name,'group',l.duplicate_group_key) from public.locations l
      where l.source='import' and l.duplicate_group_key is not null and exists(
        select 1 from public.locations other where other.id<>l.id and other.duplicate_group_key=l.duplicate_group_key
      )
  ) issues
  limit greatest(1,least(max_rows,1000));
end;
$$;

revoke all on function public.find_open_location_match_v2(text,text,double precision,double precision,text,text,text) from public,anon,authenticated;
revoke all on function public.begin_catalogue_region_refresh_v1(uuid,text,text) from public,anon,authenticated;
revoke all on function public.finalize_catalogue_region_refresh_v1(uuid,text) from public,anon,authenticated;
revoke all on function public.claim_open_photo_candidates_v1(integer,uuid) from public,anon,authenticated;
revoke all on function public.complete_open_photo_candidate_v1(uuid,text,text) from public,anon,authenticated;
revoke all on function public.catalogue_quality_review_v1(integer) from public,anon,authenticated;
grant execute on function public.find_open_location_match_v2(text,text,double precision,double precision,text,text,text) to service_role;
grant execute on function public.begin_catalogue_region_refresh_v1(uuid,text,text) to service_role;
grant execute on function public.finalize_catalogue_region_refresh_v1(uuid,text) to service_role;
grant execute on function public.claim_open_photo_candidates_v1(integer,uuid) to service_role;
grant execute on function public.complete_open_photo_candidate_v1(uuid,text,text) to service_role;
grant execute on function public.catalogue_quality_review_v1(integer) to authenticated;
