-- Keep the production OpenSearch runtime credential encrypted in Supabase Vault.
-- Only the service_role can set or read this credential through these RPCs.

create or replace function public.set_opensearch_runtime_auth(
  p_username text,
  p_password text
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
  if nullif(pg_catalog.btrim(p_username), '') is null
     or nullif(pg_catalog.btrim(p_password), '') is null then
    raise exception 'OpenSearch runtime credentials must be non-empty.' using errcode = '22023';
  end if;

  payload := pg_catalog.jsonb_build_object(
    'username', pg_catalog.btrim(p_username),
    'password', p_password
  )::text;

  select id
    into existing_id
    from vault.decrypted_secrets
   where name = 'puddle_opensearch_runtime_auth'
   order by updated_at desc
   limit 1;

  if existing_id is null then
    perform vault.create_secret(
      payload,
      'puddle_opensearch_runtime_auth',
      'Puddle read-only OpenSearch runtime Basic authentication',
      null
    );
  else
    perform vault.update_secret(
      existing_id,
      payload,
      'puddle_opensearch_runtime_auth',
      'Puddle read-only OpenSearch runtime Basic authentication',
      null
    );
  end if;
end;
$$;

create or replace function public.get_opensearch_runtime_auth()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret::jsonb
    from vault.decrypted_secrets
   where name = 'puddle_opensearch_runtime_auth'
   order by updated_at desc
   limit 1;
$$;

revoke all on function public.set_opensearch_runtime_auth(text, text) from public;
revoke all on function public.set_opensearch_runtime_auth(text, text) from anon;
revoke all on function public.set_opensearch_runtime_auth(text, text) from authenticated;
grant execute on function public.set_opensearch_runtime_auth(text, text) to service_role;

revoke all on function public.get_opensearch_runtime_auth() from public;
revoke all on function public.get_opensearch_runtime_auth() from anon;
revoke all on function public.get_opensearch_runtime_auth() from authenticated;
grant execute on function public.get_opensearch_runtime_auth() to service_role;
