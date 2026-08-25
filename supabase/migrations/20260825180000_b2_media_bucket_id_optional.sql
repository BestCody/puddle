-- Existing media runtime credentials may be restricted by bucket name without
-- exposing a bucket ID. Keep the bucket ID when supplied, but allow the same
-- safe name-scoped configuration already supported by the data runtime.

create or replace function public.set_b2_media_runtime_auth(
  p_key_id text,
  p_application_key text,
  p_bucket_id text,
  p_bucket_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_id uuid;
  payload text;
begin
  if nullif(pg_catalog.btrim(p_key_id), '') is null
     or nullif(pg_catalog.btrim(p_application_key), '') is null
     or nullif(pg_catalog.btrim(p_bucket_name), '') is null then
    raise exception 'B2 media runtime credentials must be non-empty.' using errcode = '22023';
  end if;

  payload := pg_catalog.jsonb_build_object(
    'keyId', pg_catalog.btrim(p_key_id),
    'applicationKey', p_application_key,
    'bucketId', nullif(pg_catalog.btrim(p_bucket_id), ''),
    'bucketName', pg_catalog.btrim(p_bucket_name)
  )::text;

  select id
    into existing_id
    from vault.decrypted_secrets
   where name = 'puddle_b2_media_runtime_auth'
   order by updated_at desc
   limit 1;

  if existing_id is null then
    perform vault.create_secret(
      payload,
      'puddle_b2_media_runtime_auth',
      'Puddle private Backblaze B2 media runtime authentication',
      null
    );
  else
    perform vault.update_secret(
      existing_id,
      payload,
      'puddle_b2_media_runtime_auth',
      'Puddle private Backblaze B2 media runtime authentication',
      null
    );
  end if;
end;
$$;

revoke all on function public.set_b2_media_runtime_auth(text, text, text, text) from public;
revoke all on function public.set_b2_media_runtime_auth(text, text, text, text) from anon;
revoke all on function public.set_b2_media_runtime_auth(text, text, text, text) from authenticated;
grant execute on function public.set_b2_media_runtime_auth(text, text, text, text) to service_role;
