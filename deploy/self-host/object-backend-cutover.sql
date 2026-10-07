-- Run only against the restored self-host database after the canonical object
-- inventory matches and all media_objects hashes are checked on the local target.
-- Never apply this to the live managed database during the migration.
begin;

alter table public.media_objects
  drop constraint if exists media_objects_storage_backend_values;
alter table public.media_objects
  drop constraint if exists media_objects_storage_backend_check;

update public.media_objects
set storage_backend='object_store', updated_at=now()
where storage_backend='b2';

alter table public.media_objects
  add constraint media_objects_storage_backend_values
  check (storage_backend = 'object_store');

drop function if exists public.get_b2_data_runtime_auth();
drop function if exists public.set_b2_data_runtime_auth(text,text,text,text);
drop function if exists public.get_b2_media_runtime_auth();
drop function if exists public.set_b2_media_runtime_auth(text,text,text,text);

-- These secrets belong to the retired source, never to the self-hosted store.
do $$
begin
  if to_regclass('vault.secrets') is not null then
    delete from vault.secrets
    where name in ('puddle_b2_data_runtime_auth','puddle_b2_media_runtime_auth');
  end if;
end $$;

commit;
