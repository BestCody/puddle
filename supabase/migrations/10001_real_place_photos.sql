-- Real, licensed place photography for swipe cards.
-- Provider and public-source photos remain remote references and are delivered through a guarded proxy.

create table if not exists public.location_photo_sources (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  source text not null check (source in ('venue','puddle_user','provider','licensed_public')),
  provider text not null check (provider ~ '^[a-z0-9][a-z0-9._-]{1,79}$'),
  external_photo_id text not null check (char_length(external_photo_id) between 1 and 300),
  remote_url text not null check (remote_url ~ '^https://'),
  attribution_text text check (char_length(attribution_text) <= 240),
  attribution_url text check (attribution_url is null or attribution_url ~ '^https://'),
  license_code text not null check (char_length(license_code) between 2 and 80),
  terms_url text check (terms_url is null or terms_url ~ '^https://'),
  width integer check (width is null or width between 320 and 20000),
  height integer check (height is null or height between 240 and 20000),
  is_primary boolean not null default false,
  sort_order integer not null default 0 check (sort_order between 0 and 999),
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  is_ai_generated boolean not null default false check (is_ai_generated = false),
  verified_at timestamptz,
  expires_at timestamptz,
  cache_ttl_seconds integer not null default 3600 check (cache_ttl_seconds between 0 and 86400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(location_id,provider,external_photo_id)
);

create unique index if not exists location_photo_sources_one_primary_idx
  on public.location_photo_sources(location_id)
  where is_primary and status='approved';
create index if not exists location_photo_sources_location_idx
  on public.location_photo_sources(location_id,status,is_primary desc,sort_order,verified_at desc);
create index if not exists location_photo_sources_expiry_idx
  on public.location_photo_sources(status,expires_at)
  where status='approved';

create or replace function public.touch_location_photo_source()
returns trigger language plpgsql set search_path=public as $$
begin
  new.updated_at=now();
  if new.status='approved' and new.verified_at is null then new.verified_at=now(); end if;
  return new;
end;
$$;
drop trigger if exists location_photo_sources_touch on public.location_photo_sources;
create trigger location_photo_sources_touch before insert or update on public.location_photo_sources
for each row execute function public.touch_location_photo_source();

alter table public.location_photo_sources enable row level security;

drop policy if exists "approved real location photos are public" on public.location_photo_sources;
create policy "approved real location photos are public" on public.location_photo_sources
for select using (
  status='approved'
  and is_ai_generated=false
  and (expires_at is null or expires_at>now())
  and exists(
    select 1 from public.locations l
    where l.id=location_id and l.status='published' and l.visibility='public'
  )
);

revoke all on public.location_photo_sources from public,anon,authenticated;
grant select on public.location_photo_sources to anon,authenticated;
revoke all on function public.touch_location_photo_source() from public,anon,authenticated;

comment on table public.location_photo_sources is
  'Licensed photographs of the actual location. AI-generated, stock, or unrelated imagery is prohibited.';
comment on column public.location_photo_sources.remote_url is
  'HTTPS provider asset delivered through the same-origin guarded photo proxy; never rendered directly.';
comment on column public.location_photo_sources.is_ai_generated is
  'Permanently constrained to false so generated representations cannot enter place-photo inventory.';
