alter table public.location_photo_sources
  drop constraint if exists location_photo_sources_storage_backend_values;
alter table public.location_photo_sources
  add constraint location_photo_sources_storage_backend_values
  check (storage_backend in ('remote','supabase','r2','b2'));

alter table public.media_objects
  drop constraint if exists media_objects_storage_backend_check;
alter table public.media_objects
  drop constraint if exists media_objects_storage_backend_values;
alter table public.media_objects
  add constraint media_objects_storage_backend_values
  check (storage_backend in ('r2','b2','supabase','remote'));

create or replace function public.attach_b2_media_object_v1()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  object_id uuid;
begin
  if new.storage_backend='b2' and new.content_hash is not null then
    select id into object_id from public.media_objects where content_hash=new.content_hash;
    if object_id is null then raise exception 'Backblaze B2 media object is not registered'; end if;
    new.media_object_id := object_id;
    new.storage_key := null;
    new.content_hash := null;
    new.perceptual_hash := null;
    new.byte_size := null;
  end if;
  return new;
end;
$$;

drop trigger if exists location_photo_sources_attach_b2_media on public.location_photo_sources;
create trigger location_photo_sources_attach_b2_media
before insert or update of storage_backend,storage_key,content_hash,perceptual_hash,byte_size,width,height
on public.location_photo_sources
for each row execute function public.attach_b2_media_object_v1();

comment on column public.location_photo_sources.storage_backend is
  'Remote provider, Supabase Storage, historical Cloudflare R2, or active Backblaze B2.';
comment on column public.media_objects.storage_backend is
  'New managed catalogue photo objects use Backblaze B2; historical R2 rows remain valid.';
