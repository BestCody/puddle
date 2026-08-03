-- First-pass storage split for the static R2 catalogue and cached open-licensed photos.
-- Google photos remain live Places UI Kit content; only stable Google Place IDs are stored.

alter table public.location_photo_sources
  add column if not exists storage_backend text,
  add column if not exists storage_key text,
  add column if not exists content_hash text,
  add column if not exists perceptual_hash text,
  add column if not exists byte_size integer;

update public.location_photo_sources
set storage_backend = case
  when remote_url like '%/storage/v1/object/public/%' then 'supabase'
  else coalesce(storage_backend, 'remote')
end
where storage_backend is null;

alter table public.location_photo_sources
  alter column storage_backend set default 'remote';

alter table public.location_photo_sources
  drop constraint if exists location_photo_sources_storage_backend_values;
alter table public.location_photo_sources
  add constraint location_photo_sources_storage_backend_values
  check (storage_backend in ('remote','supabase','r2'));

alter table public.location_photo_sources
  drop constraint if exists location_photo_sources_content_hash_format;
alter table public.location_photo_sources
  add constraint location_photo_sources_content_hash_format
  check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$');

alter table public.location_photo_sources
  drop constraint if exists location_photo_sources_perceptual_hash_format;
alter table public.location_photo_sources
  add constraint location_photo_sources_perceptual_hash_format
  check (perceptual_hash is null or perceptual_hash ~ '^[0-9a-f]{16}$');

alter table public.location_photo_sources
  drop constraint if exists location_photo_sources_byte_size_positive;
alter table public.location_photo_sources
  add constraint location_photo_sources_byte_size_positive
  check (byte_size is null or byte_size > 0);

create index if not exists location_photo_sources_content_hash_idx
  on public.location_photo_sources(content_hash)
  where content_hash is not null and status = 'approved';
create index if not exists location_photo_sources_storage_backend_idx
  on public.location_photo_sources(storage_backend, storage_key)
  where storage_key is not null;
create index if not exists location_photo_sources_perceptual_hash_idx
  on public.location_photo_sources(perceptual_hash)
  where perceptual_hash is not null and status = 'approved';

comment on column public.location_photo_sources.storage_backend is
  'remote, Supabase Storage, or Cloudflare R2. Google Places photos are never represented here.';
comment on column public.location_photo_sources.content_hash is
  'SHA-256 of the processed image bytes, used for exact deduplication.';
comment on column public.location_photo_sources.perceptual_hash is
  '64-bit dHash of the processed image, used to identify near-duplicate open photos.';
