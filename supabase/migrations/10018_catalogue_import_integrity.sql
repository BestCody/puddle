-- Catalogue import integrity: atomic service-role writes, honest empty states,
-- private-location-safe matching, and automatic recovery of prior false successes.

alter table public.catalogue_sync_regions
  drop constraint if exists catalogue_sync_regions_status_check;
alter table public.catalogue_sync_regions
  add constraint catalogue_sync_regions_status_check
  check (status in ('queued','processing','ready','empty','failed'));
create index if not exists catalogue_sync_regions_refresh_idx
  on public.catalogue_sync_regions(status,synced_at,requested_at);

create or replace function public.find_open_location_match_v1(
  target_name text,
  target_kind text,
  target_latitude double precision,
  target_longitude double precision,
  target_city text
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.id
  from public.locations l
  where l.status not in ('rejected','suspended','archived')
    and l.latitude is not null
    and l.longitude is not null
    and coalesce(l.has_private_address,false)=false
    and l.visibility in ('public','unlisted')
    and abs(l.latitude-target_latitude)<=0.001
    and abs(l.longitude-target_longitude)<=0.001
    and lower(coalesce(l.city,''))=lower(coalesce(target_city,''))
    and (l.kind=target_kind or l.kind='other' or target_kind='other')
    and regexp_replace(lower(l.name),'[^a-z0-9]+','','g')=
        regexp_replace(lower(target_name),'[^a-z0-9]+','','g')
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
  place_name text:=nullif(trim(payload->>'name'),'');
  place_slug text:=nullif(trim(payload->>'slug'),'');
  place_kind text:=nullif(trim(payload->>'kind'),'');
  place_city text:=coalesce(nullif(trim(payload->>'city'),''),'Unknown city');
  place_latitude double precision;
  place_longitude double precision;
  place_confidence numeric;
  place_source_updated_at timestamptz;
  place_amenities text[]:='{}'::text[];
  location_id_value uuid;
  location_source_value text;
begin
  if import_source not in ('fsq_os','overture') then
    raise exception 'unsupported catalogue source';
  end if;
  if source_id is null or char_length(source_id)>240 then
    raise exception 'invalid source place id';
  end if;
  if place_name is null or char_length(place_name) not between 2 and 120 then
    raise exception 'invalid place name';
  end if;
  if place_slug is null or place_slug !~ '^[a-z0-9-]{3,100}$' then
    raise exception 'invalid place slug';
  end if;
  if place_kind not in (
    'cafe','restaurant','bar','park','museum','gallery','attraction',
    'activity_venue','study_spot','scenic_spot','nightlife','shop',
    'community_space','other'
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
  if nullif(payload->>'source_updated_at','') is not null then
    place_source_updated_at:=(payload->>'source_updated_at')::timestamptz;
  end if;
  if jsonb_typeof(coalesce(payload->'amenities','[]'::jsonb))='array' then
    select coalesce(array_agg(left(value,50)) filter(where nullif(trim(value),'') is not null),'{}'::text[])
      into place_amenities
    from jsonb_array_elements_text(coalesce(payload->'amenities','[]'::jsonb));
  end if;

  select l.location_id into location_id_value
  from public.location_source_links l
  where l.source=import_source and l.source_place_id=source_id;

  if location_id_value is null then
    location_id_value:=public.find_open_location_match_v1(
      place_name,place_kind,place_latitude,place_longitude,place_city
    );
  end if;

  if location_id_value is null then
    insert into public.locations(
      name,slug,kind,summary,city,neighborhood,region,country,country_code,
      address_public,latitude,longitude,timezone,amenities,accessibility,
      opening_hours,status,visibility,has_private_address,source,published_at
    ) values (
      place_name,place_slug,place_kind,nullif(trim(payload->>'summary'),''),place_city,
      nullif(trim(payload->>'neighborhood'),''),nullif(trim(payload->>'region'),''),
      nullif(trim(payload->>'country'),''),nullif(trim(payload->>'country_code'),''),
      nullif(trim(payload->>'address_public'),''),place_latitude,place_longitude,
      coalesce(nullif(trim(payload->>'timezone'),''),'UTC'),place_amenities,
      '{}'::jsonb,'{}'::jsonb,'published','public',false,'import',now()
    ) returning id into location_id_value;
  else
    select source into location_source_value from public.locations where id=location_id_value for update;
    if location_source_value='import' then
      perform set_config('puddle.allow_status_transition','on',true);
      perform set_config('puddle.change_source','update',true);
      update public.locations set
        name=place_name,
        kind=place_kind,
        summary=nullif(trim(payload->>'summary'),''),
        city=place_city,
        neighborhood=nullif(trim(payload->>'neighborhood'),''),
        region=nullif(trim(payload->>'region'),''),
        country=nullif(trim(payload->>'country'),''),
        country_code=nullif(trim(payload->>'country_code'),''),
        address_public=nullif(trim(payload->>'address_public'),''),
        latitude=place_latitude,
        longitude=place_longitude,
        timezone=coalesce(nullif(trim(payload->>'timezone'),''),'UTC'),
        amenities=place_amenities,
        status='published',
        visibility='public',
        has_private_address=false,
        published_at=coalesce(published_at,now()),
        updated_at=now()
      where id=location_id_value;
    end if;
  end if;

  insert into public.location_source_links(
    source,source_place_id,location_id,source_confidence,source_updated_at,
    last_seen_at,payload_hash,updated_at
  ) values (
    import_source,source_id,location_id_value,place_confidence,place_source_updated_at,
    now(),nullif(trim(payload->>'payload_hash'),''),now()
  ) on conflict(source,source_place_id) do update set
    location_id=excluded.location_id,
    source_confidence=excluded.source_confidence,
    source_updated_at=excluded.source_updated_at,
    last_seen_at=now(),
    payload_hash=excluded.payload_hash,
    updated_at=now();

  insert into public.location_descriptions(
    location_id,source,description,facts_used,status,verified_at,updated_at
  ) values (
    location_id_value,'generated_factual',
    left(coalesce(nullif(trim(payload->>'summary'),''),'A place in '||place_city||'. Details have not yet been verified.'),500),
    jsonb_build_object(
      'kind',place_kind,'city',place_city,'region',nullif(trim(payload->>'region'),''),
      'country',nullif(trim(payload->>'country'),''),'neighborhood',nullif(trim(payload->>'neighborhood'),'')
    ),'approved',now(),now()
  ) on conflict(location_id,source) do update set
    description=excluded.description,
    facts_used=excluded.facts_used,
    status='approved',
    verified_at=now(),
    updated_at=now();

  return location_id_value;
end;
$$;

create or replace function public.upsert_open_catalogue_batch_v1(
  import_source text,
  payloads jsonb
)
returns table(source_place_id text,location_id uuid,error_message text)
language plpgsql
security definer
set search_path=public
as $$
declare
  item jsonb;
begin
  if jsonb_typeof(payloads)<>'array' then raise exception 'catalogue payload must be an array'; end if;
  if jsonb_array_length(payloads)>200 then raise exception 'catalogue batch exceeds 200 records'; end if;

  for item in select value from jsonb_array_elements(payloads) loop
    source_place_id:=left(coalesce(item->>'source_place_id',''),240);
    begin
      location_id:=public.upsert_open_catalogue_location_v1(import_source,item);
      error_message:=null;
    exception when others then
      location_id:=null;
      error_message:=left(sqlerrm,500);
    end;
    return next;
  end loop;
end;
$$;

revoke all on function public.upsert_open_catalogue_location_v1(text,jsonb) from public,anon,authenticated;
revoke all on function public.upsert_open_catalogue_batch_v1(text,jsonb) from public,anon,authenticated;
grant execute on function public.upsert_open_catalogue_location_v1(text,jsonb) to service_role;
grant execute on function public.upsert_open_catalogue_batch_v1(text,jsonb) to service_role;

-- PR #35 could mark a region ready even when every record failed. Retry those
-- regions automatically after this migration reaches the hosted database.
update public.catalogue_sync_regions
set status='queued',
    requested_at=now(),
    synced_at=null,
    release_id=null,
    error_message='Requeued after zero-import integrity repair',
    updated_at=now()
where status='ready' and imported_count=0;
