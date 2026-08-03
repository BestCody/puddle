-- Runtime optimization pass for the R2 catalogue, compact static actions,
-- on-demand materialization retention, Google retry state, and shared media objects.

create table if not exists public.media_objects (
  id uuid primary key default gen_random_uuid(),
  storage_backend text not null check (storage_backend in ('r2','supabase','remote')),
  storage_key text not null,
  public_url text,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  perceptual_hash text check (perceptual_hash is null or perceptual_hash ~ '^[0-9a-f]{16}$'),
  byte_size integer not null check (byte_size > 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists media_objects_content_hash_uidx on public.media_objects(content_hash);
create unique index if not exists media_objects_storage_uidx on public.media_objects(storage_backend,storage_key);
alter table public.media_objects enable row level security;
revoke all on table public.media_objects from public,anon,authenticated;
grant select,insert,update,delete on table public.media_objects to service_role;

alter table public.location_photo_sources
  add column if not exists media_object_id uuid references public.media_objects(id) on delete restrict;
create index if not exists location_photo_sources_media_object_idx
  on public.location_photo_sources(media_object_id)
  where media_object_id is not null;

insert into public.media_objects(
  storage_backend,storage_key,public_url,content_hash,perceptual_hash,byte_size,width,height
)
select distinct on (source.content_hash)
  'r2',source.storage_key,source.remote_url,source.content_hash,source.perceptual_hash,
  source.byte_size,source.width,source.height
from public.location_photo_sources source
where source.storage_backend='r2'
  and source.storage_key is not null
  and source.content_hash is not null
  and source.byte_size is not null
order by source.content_hash,source.verified_at desc nulls last
on conflict do nothing;

update public.location_photo_sources source
set media_object_id=media.id,
    storage_key=null,
    content_hash=null,
    perceptual_hash=null,
    byte_size=null
from public.media_objects media
where source.storage_backend='r2'
  and source.media_object_id is null
  and source.content_hash=media.content_hash;

drop index if exists public.location_photo_sources_content_hash_idx;
drop index if exists public.location_photo_sources_perceptual_hash_idx;
comment on column public.location_photo_sources.media_object_id is
  'Shared immutable media object. R2 object hashes, keys, dimensions, and byte size live in media_objects rather than being duplicated per attribution row.';
comment on column public.location_photo_sources.storage_key is 'Deprecated for managed R2 media; use media_object_id.';
comment on column public.location_photo_sources.content_hash is 'Deprecated for managed R2 media; use media_object_id.';
comment on column public.location_photo_sources.perceptual_hash is 'Deprecated for managed R2 media; use media_object_id.';
comment on column public.location_photo_sources.byte_size is 'Deprecated for managed R2 media; use media_object_id.';

create or replace function public.attach_r2_media_object_v1()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  object_id uuid;
begin
  if new.storage_backend='r2' and new.content_hash is not null then
    select id into object_id from public.media_objects where content_hash=new.content_hash;
    if object_id is null then raise exception 'R2 media object is not registered'; end if;
    new.media_object_id := object_id;
    new.storage_key := null;
    new.content_hash := null;
    new.perceptual_hash := null;
    new.byte_size := null;
  end if;
  return new;
end;
$$;
drop trigger if exists location_photo_sources_attach_r2_media on public.location_photo_sources;
create trigger location_photo_sources_attach_r2_media
before insert or update of storage_backend,storage_key,content_hash,perceptual_hash,byte_size,width,height
on public.location_photo_sources
for each row execute function public.attach_r2_media_object_v1();

create table if not exists public.static_catalogue_actions (
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid not null,
  source text not null check (source in ('overture','fsq_os')),
  source_place_id text not null check (char_length(source_place_id) between 1 and 240),
  action text not null check (action='dismissed'),
  last_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '90 days'),
  primary key(user_id,location_id)
);
create index if not exists static_catalogue_actions_expiry_idx
  on public.static_catalogue_actions(expires_at);
alter table public.static_catalogue_actions enable row level security;
drop policy if exists static_catalogue_actions_select_own on public.static_catalogue_actions;
create policy static_catalogue_actions_select_own on public.static_catalogue_actions
  for select to authenticated using (auth.uid()=user_id);
revoke all on table public.static_catalogue_actions from public,anon;
grant select on table public.static_catalogue_actions to authenticated;
grant select,insert,update,delete on table public.static_catalogue_actions to service_role;

create table if not exists public.static_catalogue_materializations (
  location_id uuid primary key references public.locations(id) on delete cascade,
  source text not null check (source in ('overture','fsq_os')),
  source_place_id text not null,
  materialized_at timestamptz not null default now(),
  last_touched_at timestamptz not null default now(),
  retention_class text not null default 'opened'
    check (retention_class in ('opened','saved','perfect','visited','shared','photo','google')),
  expires_at timestamptz
);
create unique index if not exists static_catalogue_materializations_source_uidx
  on public.static_catalogue_materializations(source,source_place_id);
create index if not exists static_catalogue_materializations_expiry_idx
  on public.static_catalogue_materializations(expires_at)
  where expires_at is not null;
alter table public.static_catalogue_materializations enable row level security;
revoke all on table public.static_catalogue_materializations from public,anon,authenticated;
grant select,insert,update,delete on table public.static_catalogue_materializations to service_role;

create or replace function public.retain_static_location_with_photo_v1()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.status='approved' and new.is_ai_generated is not true then
    update public.static_catalogue_materializations
    set last_touched_at=now(),retention_class='photo',expires_at=null
    where location_id=new.location_id;
  end if;
  return new;
end;
$$;
drop trigger if exists location_photo_sources_retain_static on public.location_photo_sources;
create trigger location_photo_sources_retain_static
after insert or update of status,is_ai_generated
on public.location_photo_sources
for each row execute function public.retain_static_location_with_photo_v1();

create table if not exists public.google_place_match_attempts (
  location_id uuid primary key references public.locations(id) on delete cascade,
  status text not null check (status in ('no_match','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz not null default now(),
  retry_after timestamptz not null,
  last_error text,
  updated_at timestamptz not null default now()
);
create index if not exists google_place_match_attempts_retry_idx
  on public.google_place_match_attempts(retry_after,status);
alter table public.google_place_match_attempts enable row level security;
revoke all on table public.google_place_match_attempts from public,anon,authenticated;
grant select,insert,update,delete on table public.google_place_match_attempts to service_role;

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
  if import_source not in ('overture','fsq_os') then raise exception 'unsupported catalogue source'; end if;
  if nullif(trim(source_place_id),'') is null then raise exception 'source place id is required'; end if;
  if action_name='undo' then
    delete from public.static_catalogue_actions
    where user_id=actor and location_id=target_location;
    return jsonb_build_object('action','undo','locationId',target_location);
  end if;
  if action_name<>'dismissed' then raise exception 'unsupported static action'; end if;
  insert into public.static_catalogue_actions(
    user_id,location_id,source,source_place_id,action,last_request_id,created_at,updated_at,expires_at
  ) values (
    actor,target_location,import_source,source_place_id,'dismissed',request_key,now(),now(),now()+interval '90 days'
  )
  on conflict(user_id,location_id) do update set
    source=excluded.source,
    source_place_id=excluded.source_place_id,
    action='dismissed',
    last_request_id=excluded.last_request_id,
    updated_at=now(),
    expires_at=now()+interval '90 days';
  return jsonb_build_object('action','dismissed','locationId',target_location);
end;
$$;
revoke all on function public.record_static_catalogue_action_v1(uuid,text,text,text,uuid) from public,anon;
grant execute on function public.record_static_catalogue_action_v1(uuid,text,text,text,uuid) to authenticated;

create or replace function public.touch_static_catalogue_materializations_v1(
  location_ids uuid[],
  touch_reason text
)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  changed integer := 0;
  normalized text := lower(coalesce(touch_reason,''));
begin
  if auth.uid() is null and coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'authentication required';
  end if;
  if normalized not in ('opened','saved','perfect','visited','shared','photo','google') then
    raise exception 'unsupported materialization touch reason';
  end if;
  update public.static_catalogue_materializations materialization
  set last_touched_at=now(),
      retention_class=case
        when array_position(array['opened','saved','visited','perfect','shared','photo','google'],normalized)
           > array_position(array['opened','saved','visited','perfect','shared','photo','google'],materialization.retention_class)
          then normalized
        else materialization.retention_class
      end,
      expires_at=case
        when materialization.retention_class<>'opened' or normalized<>'opened' then null
        else now()+interval '30 days'
      end
  where materialization.location_id=any(coalesce(location_ids,'{}'::uuid[]));
  get diagnostics changed=row_count;
  return changed;
end;
$$;
revoke all on function public.touch_static_catalogue_materializations_v1(uuid[],text) from public,anon;
grant execute on function public.touch_static_catalogue_materializations_v1(uuid[],text) to authenticated,service_role;

create or replace function public.record_discovery_action_v2(
  target_kind text,
  target_id uuid,
  action_name text,
  requested_action text,
  request_key uuid,
  context_mode text,
  context_category text,
  context_payload jsonb,
  is_static_ephemeral boolean default false,
  static_source text default null,
  static_source_place_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  event_name text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if is_static_ephemeral and action_name in ('dismissed','undo') then
    return public.record_static_catalogue_action_v1(
      target_id,static_source,static_source_place_id,action_name,request_key
    );
  end if;

  if action_name in ('saved','interested','dismissed','visited','undo') then
    perform public.record_discovery_action_v1(
      target_kind=>target_kind,
      target_id=>target_id,
      action_name=>action_name,
      request_key=>request_key
    );
  end if;

  perform public.record_recommendation_outcome_v1(
    request_key=>request_key,
    target_kind=>target_kind,
    target_id=>target_id,
    outcome_name=>action_name,
    outcome_metadata=>jsonb_build_object('surface','discover','perfect_pick',requested_action='perfect')
  );

  event_name := case
    when requested_action='perfect' then 'perfect'
    when action_name='dismissed' then 'pass'
    when action_name in ('saved','interested') then 'save'
    when action_name='visited' then 'visited'
    when action_name='opened' then 'opened'
    else null
  end;
  if target_kind='place' and event_name is not null then
    perform public.record_recommendation_context_v1(
      target_location=>target_id,
      event_name=>event_name,
      context_mode=>coalesce(context_mode,'solo'),
      context_category=>context_category,
      context_payload=>coalesce(context_payload,'{}'::jsonb),
      context_deck=>null
    );
  end if;

  if target_kind='place' and action_name in ('saved','interested','visited','opened') then
    perform public.touch_static_catalogue_materializations_v1(
      array[target_id],
      case when requested_action='perfect' then 'perfect'
           when action_name in ('saved','interested') then 'saved'
           else action_name end
    );
  end if;
  return jsonb_build_object('action',action_name,'locationId',target_id,'perfectPick',requested_action='perfect');
end;
$$;
revoke all on function public.record_discovery_action_v2(text,uuid,text,text,uuid,text,text,jsonb,boolean,text,text) from public,anon;
grant execute on function public.record_discovery_action_v2(text,uuid,text,text,uuid,text,text,jsonb,boolean,text,text) to authenticated;

create or replace function public.materialize_static_catalogue_location_v1(
  target_location uuid,
  import_source text,
  payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  source_id text := nullif(trim(payload->>'source_place_id'),'');
  place_name text := nullif(trim(payload->>'name'),'');
  place_slug text := nullif(trim(payload->>'slug'),'');
  place_kind text := nullif(trim(payload->>'kind'),'');
  place_city text := coalesce(nullif(trim(payload->>'city'),''),nullif(trim(payload->>'region'),''),nullif(trim(payload->>'country'),''),'Unspecified locality');
  place_latitude double precision;
  place_longitude double precision;
  mapped_location uuid;
begin
  if target_location is null then raise exception 'target location is required'; end if;
  if import_source not in ('overture','fsq_os') then raise exception 'unsupported catalogue source'; end if;
  if source_id is null or char_length(source_id)>240 then raise exception 'invalid source place id'; end if;
  if place_name is null or char_length(place_name) not between 2 and 120 then raise exception 'invalid place name'; end if;
  if place_slug is null or place_slug !~ '^[a-z0-9-]{3,100}$' then raise exception 'invalid place slug'; end if;
  if place_kind not in ('cafe','restaurant','bar','park','museum','gallery','attraction','activity_venue','study_spot','scenic_spot','nightlife','shop','community_space','other') then
    raise exception 'invalid place kind';
  end if;
  place_latitude := (payload->>'latitude')::double precision;
  place_longitude := (payload->>'longitude')::double precision;
  if place_latitude not between -90 and 90 or place_longitude not between -180 and 180 then raise exception 'invalid place coordinates'; end if;

  perform pg_advisory_xact_lock(hashtextextended(import_source||':'||source_id,0));
  select location_id into mapped_location from public.location_source_links
  where source=import_source and source_place_id=source_id;
  if mapped_location is not null then
    insert into public.static_catalogue_materializations(location_id,source,source_place_id,materialized_at,last_touched_at,retention_class,expires_at)
    values(mapped_location,import_source,source_id,now(),now(),'opened',now()+interval '30 days')
    on conflict(location_id) do update set last_touched_at=now();
    return mapped_location;
  end if;

  insert into public.locations(
    id,name,slug,kind,summary,city,neighborhood,region,region_code,country,country_code,
    postal_code,address_public,latitude,longitude,timezone,timezone_verified,timezone_source,
    amenities,accessibility,opening_hours,price_level,website_url,phone_public,brand_id,brand_name,
    source_parent_place_id,duplicate_group_key,catalogue_group_key,category_confidence,
    normalization_version,category_mapping_version,source_operating_status,source_metadata,
    status,visibility,has_private_address,source,photo_enrichment_status,published_at
  ) values (
    target_location,place_name,place_slug,place_kind,nullif(trim(payload->>'summary'),''),place_city,
    nullif(trim(payload->>'neighborhood'),''),nullif(trim(payload->>'region'),''),nullif(trim(payload->>'region_code'),''),
    nullif(trim(payload->>'country'),''),nullif(trim(payload->>'country_code'),''),nullif(trim(payload->>'postal_code'),''),
    nullif(trim(payload->>'address_public'),''),place_latitude,place_longitude,
    coalesce(nullif(trim(payload->>'timezone'),''),'UTC'),nullif(trim(payload->>'timezone'),'') is not null,
    case when nullif(trim(payload->>'timezone'),'') is not null then import_source else null end,
    coalesce(array(select jsonb_array_elements_text(coalesce(payload->'amenities','[]'::jsonb))),'{}'::text[]),
    case when jsonb_typeof(coalesce(payload->'accessibility','{}'::jsonb))='object' then coalesce(payload->'accessibility','{}'::jsonb) else '{}'::jsonb end,
    case when jsonb_typeof(coalesce(payload->'opening_hours','{}'::jsonb))='object' then coalesce(payload->'opening_hours','{}'::jsonb) else '{}'::jsonb end,
    nullif(payload->>'price_level','')::smallint,nullif(trim(payload->>'website_url'),''),nullif(trim(payload->>'phone_public'),''),
    nullif(trim(payload->>'brand_id'),''),nullif(trim(payload->>'brand_name'),''),nullif(trim(payload->>'source_parent_place_id'),''),
    nullif(trim(payload->>'duplicate_group_key'),''),nullif(trim(payload->>'catalogue_group_key'),''),
    nullif(payload->>'category_confidence','')::numeric,nullif(payload->>'normalization_version','')::integer,
    nullif(payload->>'category_mapping_version','')::integer,null,'{}'::jsonb,
    'published','public',false,'import','pending',now()
  ) on conflict(id) do nothing;

  insert into public.location_source_links(
    source,source_place_id,location_id,source_confidence,source_updated_at,last_seen_at,payload_hash,
    source_parent_place_id,source_brand_id,source_release_id,source_operating_status,
    normalization_version,category_mapping_version,source_metadata,missed_refreshes,stale_since,created_at,updated_at
  ) values (
    import_source,source_id,target_location,nullif(payload->>'source_confidence','')::numeric,
    nullif(payload->>'source_updated_at','')::timestamptz,now(),nullif(trim(payload->>'payload_hash'),''),
    nullif(trim(payload->>'source_parent_place_id'),''),nullif(trim(payload->>'brand_id'),''),
    nullif(trim(payload->>'source_release_id'),''),nullif(trim(payload->>'source_operating_status'),''),
    nullif(payload->>'normalization_version','')::integer,nullif(payload->>'category_mapping_version','')::integer,
    case when jsonb_typeof(coalesce(payload->'source_metadata','{}'::jsonb))='object' then coalesce(payload->'source_metadata','{}'::jsonb) else '{}'::jsonb end,
    0,null,now(),now()
  ) on conflict(source,source_place_id) do nothing;

  select location_id into mapped_location from public.location_source_links
  where source=import_source and source_place_id=source_id;
  if mapped_location is distinct from target_location then
    delete from public.locations orphan where orphan.id=target_location and orphan.source='import'
      and not exists(select 1 from public.location_source_links link where link.location_id=orphan.id);
  end if;
  mapped_location := coalesce(mapped_location,target_location);
  insert into public.static_catalogue_materializations(location_id,source,source_place_id,materialized_at,last_touched_at,retention_class,expires_at)
  values(mapped_location,import_source,source_id,now(),now(),'opened',now()+interval '30 days')
  on conflict(location_id) do update set last_touched_at=now();
  return mapped_location;
end;
$$;
revoke all on function public.materialize_static_catalogue_location_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.materialize_static_catalogue_location_v1(uuid,text,jsonb) to service_role;

create or replace function public.claim_google_place_candidates_v1(batch_size integer default 100)
returns table(
  id uuid,name text,latitude double precision,longitude double precision,city text,region text,
  country text,country_code text,attempt_count integer
)
language sql
security definer
set search_path=public
as $$
  select location.id,location.name,location.latitude,location.longitude,location.city,location.region,
         location.country,location.country_code,coalesce(attempt.attempt_count,0)
  from public.locations location
  left join public.google_place_match_attempts attempt on attempt.location_id=location.id
  left join public.static_catalogue_materializations materialization on materialization.location_id=location.id
  where location.status='published' and location.visibility='public'
    and location.latitude is not null and location.longitude is not null
    and not exists(
      select 1 from public.location_google_places mapping
      where mapping.location_id=location.id and mapping.status='verified'
    )
    and not exists(
      select 1 from public.location_photo_sources photo
      where photo.location_id=location.id and photo.status='approved' and photo.is_ai_generated is not true
    )
    and (attempt.retry_after is null or attempt.retry_after<=now())
  order by coalesce(materialization.last_touched_at,location.published_at) desc nulls last,
           coalesce(attempt.attempt_count,0) asc,
           location.id
  limit greatest(1,least(coalesce(batch_size,100),1000));
$$;
revoke all on function public.claim_google_place_candidates_v1(integer) from public,anon,authenticated;
grant execute on function public.claim_google_place_candidates_v1(integer) to service_role;

create or replace function public.delete_cold_static_materialization_v1(target_location uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  candidate public.static_catalogue_materializations%rowtype;
begin
  select * into candidate from public.static_catalogue_materializations
  where location_id=target_location and expires_at is not null and expires_at<now()
  for update;
  if not found then return false; end if;
  if exists(select 1 from public.location_photo_sources where location_id=target_location and status='approved') then return false; end if;
  if exists(select 1 from public.location_google_places where location_id=target_location and status='verified') then return false; end if;
  begin
    delete from public.locations where id=target_location and source='import';
    return found;
  exception when foreign_key_violation then
    return false;
  end;
end;
$$;
revoke all on function public.delete_cold_static_materialization_v1(uuid) from public,anon,authenticated;
grant execute on function public.delete_cold_static_materialization_v1(uuid) to service_role;

update public.locations location
set source_metadata='{}'::jsonb,
    source_operating_status=null
where exists(select 1 from public.static_catalogue_materializations materialization where materialization.location_id=location.id);
