-- Keep private Backblaze B2 canonical-data runtime credentials encrypted in Supabase Vault.
-- Only service_role can set or read this credential through these RPCs.

create or replace function public.set_b2_data_runtime_auth(
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
    raise exception 'B2 data runtime credentials must be non-empty.' using errcode = '22023';
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
   where name = 'puddle_b2_data_runtime_auth'
   order by updated_at desc
   limit 1;

  if existing_id is null then
    perform vault.create_secret(
      payload,
      'puddle_b2_data_runtime_auth',
      'Puddle private Backblaze B2 canonical-data runtime authentication',
      null
    );
  else
    perform vault.update_secret(
      existing_id,
      payload,
      'puddle_b2_data_runtime_auth',
      'Puddle private Backblaze B2 canonical-data runtime authentication',
      null
    );
  end if;
end;
$$;

create or replace function public.get_b2_data_runtime_auth()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret::jsonb
    from vault.decrypted_secrets
   where name = 'puddle_b2_data_runtime_auth'
   order by updated_at desc
   limit 1;
$$;

revoke all on function public.set_b2_data_runtime_auth(text, text, text, text) from public;
revoke all on function public.set_b2_data_runtime_auth(text, text, text, text) from anon;
revoke all on function public.set_b2_data_runtime_auth(text, text, text, text) from authenticated;
grant execute on function public.set_b2_data_runtime_auth(text, text, text, text) to service_role;

revoke all on function public.get_b2_data_runtime_auth() from public;
revoke all on function public.get_b2_data_runtime_auth() from anon;
revoke all on function public.get_b2_data_runtime_auth() from authenticated;
grant execute on function public.get_b2_data_runtime_auth() to service_role;
