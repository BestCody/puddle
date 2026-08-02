-- Worldwide discovery foundation: precise user locations, regional catalogue refresh queues,
-- and worldwide metadata for imported places.

alter table public.profiles add column if not exists country_code text;
alter table public.profiles add column if not exists country text;
alter table public.profiles add column if not exists region text;
alter table public.profiles add column if not exists timezone text;
alter table public.profiles add column if not exists location_label text;
alter table public.profiles add column if not exists location_source text;
alter table public.profiles add column if not exists location_accuracy_m real;
alter table public.profiles add column if not exists location_updated_at timestamptz;

alter table public.locations add column if not exists country_code text;
alter table public.locations add column if not exists country text;
alter table public.locations add column if not exists region text;

update public.profiles
set location_label=coalesce(location_label,city),
    location_source=coalesce(location_source,case when latitude is not null and longitude is not null then 'legacy' else null end),
    location_updated_at=coalesce(location_updated_at,updated_at)
where location_label is null or location_source is null or location_updated_at is null;

update public.locations
set country_code=upper(country_code)
where country_code is not null;

update public.profiles
set country_code=upper(country_code)
where country_code is not null;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='profiles_country_code_format') then
    alter table public.profiles add constraint profiles_country_code_format check(country_code is null or country_code ~ '^[A-Z]{2}$');
  end if;
  if not exists(select 1 from pg_constraint where conname='profiles_location_source_values') then
    alter table public.profiles add constraint profiles_location_source_values check(location_source is null or location_source in ('browser','city_search','legacy','admin'));
  end if;
  if not exists(select 1 from pg_constraint where conname='profiles_location_accuracy_positive') then
    alter table public.profiles add constraint profiles_location_accuracy_positive check(location_accuracy_m is null or location_accuracy_m>=0);
  end if;
  if not exists(select 1 from pg_constraint where conname='locations_country_code_format') then
    alter table public.locations add constraint locations_country_code_format check(country_code is null or country_code ~ '^[A-Z]{2}$');
  end if;
end $$;

create table if not exists public.catalogue_sync_regions (
  id uuid primary key default gen_random_uuid(),
  region_key text not null unique,
  center_latitude double precision not null check(center_latitude between -90 and 90),
  center_longitude double precision not null check(center_longitude between -180 and 180),
  radius_km integer not null check(radius_km between 2 and 100),
  source text not null default 'overture' check(source in ('overture','fsq_os')),
  status text not null default 'queued' check(status in ('queued','processing','ready','failed')),
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  synced_at timestamptz,
  release_id text,
  attempts integer not null default 0 check(attempts between 0 and 1000),
  imported_count integer not null default 0 check(imported_count>=0),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists catalogue_sync_regions_status_idx on public.catalogue_sync_regions(status,requested_at);
create index if not exists catalogue_sync_regions_stale_idx on public.catalogue_sync_regions(synced_at) where status='ready';

create or replace function public.catalogue_radius_bucket(value integer)
returns integer language sql immutable as $$
  select case when coalesce(value,10)<=10 then 10 when value<=25 then 25 when value<=50 then 50 else 100 end
$$;

create or replace function public.queue_catalogue_region_v1(target_profile uuid default auth.uid())
returns uuid language plpgsql security definer set search_path=public as $$
declare
  profile_row public.profiles%rowtype;
  bucket integer;
  key_value text;
  result_id uuid;
begin
  if target_profile is null then return null; end if;
  if auth.uid() is not null and target_profile<>auth.uid() and not public.is_admin() then
    raise exception 'profile location unavailable';
  end if;
  select * into profile_row from public.profiles where id=target_profile;
  if profile_row.id is null or profile_row.latitude is null or profile_row.longitude is null then return null; end if;

  bucket:=public.catalogue_radius_bucket(profile_row.search_radius_km);
  key_value:=round(profile_row.latitude::numeric,2)::text||':'||round(profile_row.longitude::numeric,2)::text||':'||bucket::text;
  insert into public.catalogue_sync_regions(region_key,center_latitude,center_longitude,radius_km,status,requested_at,updated_at)
  values(key_value,profile_row.latitude,profile_row.longitude,bucket,'queued',now(),now())
  on conflict(region_key) do update set
    center_latitude=excluded.center_latitude,
    center_longitude=excluded.center_longitude,
    radius_km=greatest(public.catalogue_sync_regions.radius_km,excluded.radius_km),
    requested_at=now(),
    status=case
      when public.catalogue_sync_regions.synced_at is null or public.catalogue_sync_regions.synced_at<now()-interval '30 days' then 'queued'
      else public.catalogue_sync_regions.status
    end,
    updated_at=now()
  returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.queue_profile_catalogue_region_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.latitude is not null and new.longitude is not null then
    perform public.queue_catalogue_region_v1(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_queue_catalogue_region on public.profiles;
create trigger profiles_queue_catalogue_region
after insert or update of latitude,longitude,search_radius_km on public.profiles
for each row execute function public.queue_profile_catalogue_region_trigger();

create or replace function public.touch_catalogue_sync_region()
returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists catalogue_sync_regions_touch_updated_at on public.catalogue_sync_regions;
create trigger catalogue_sync_regions_touch_updated_at before update on public.catalogue_sync_regions
for each row execute function public.touch_catalogue_sync_region();

alter table public.catalogue_sync_regions enable row level security;
drop policy if exists "admins view catalogue sync regions" on public.catalogue_sync_regions;
create policy "admins view catalogue sync regions" on public.catalogue_sync_regions for select using(public.is_admin());

grant execute on function public.queue_catalogue_region_v1(uuid) to authenticated;
grant select on public.catalogue_sync_regions to authenticated;

select public.queue_catalogue_region_v1(id)
from public.profiles
where latitude is not null and longitude is not null;
