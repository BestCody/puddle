-- Add YFCC100M to the canonical photo identity registry.
-- OSV-5M and MSLS are Mapillary-derived and intentionally retain provider_code
-- 2 so the same Mapillary asset cannot enter twice under different datasets.

do $$
declare
  constraint_row record;
begin
  -- The original checks were anonymous PostgreSQL-generated names. Remove only
  -- checks whose definition refers to provider_code, then install stable names.
  for constraint_row in
    select c.conrelid::regclass as relation_name, c.conname
    from pg_constraint c
    where c.connamespace='public'::regnamespace
      and c.contype='c'
      and c.conrelid in (
        'public.global_photo_claims'::regclass,
        'public.global_photo_candidate_registry'::regclass
      )
      and pg_get_constraintdef(c.oid) ilike '%provider_code%'
  loop
    execute format('alter table %s drop constraint %I', constraint_row.relation_name, constraint_row.conname);
  end loop;
end $$;

alter table public.global_photo_claims
  add constraint global_photo_claims_provider_code_check
  check (provider_code between 1 and 4);

alter table public.global_photo_candidate_registry
  add constraint global_photo_candidate_registry_provider_code_check
  check (provider_code between 1 and 4);

-- Recreate the already-deployed security-definer RPCs from their live
-- definitions, changing only the provider-code validation. This keeps later
-- hardening changes intact without copying three long function bodies into a
-- migration and accidentally diverging them.
do $$
declare
  function_row record;
  original_definition text;
  rewritten_definition text;
  changed_count integer := 0;
begin
  for function_row in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'claim_global_photo_v1',
        'register_existing_global_photo_v1',
        'reserve_global_photo_candidate_v1'
      )
  loop
    original_definition := pg_get_functiondef(function_row.oid);
    rewritten_definition := regexp_replace(
      original_definition,
      '\mnot\s+between\s+1\s+and\s+3\M',
      'not between 1 and 4',
      'gi'
    );
    rewritten_definition := regexp_replace(
      rewritten_definition,
      '\mbetween\s+1\s+and\s+3\M',
      'between 1 and 4',
      'gi'
    );
    rewritten_definition := replace(
      rewritten_definition,
      'provider_code must be 1, 2, or 3',
      'provider_code must be 1, 2, 3, or 4'
    );
    if function_row.proname='reserve_global_photo_candidate_v1' then
      rewritten_definition := replace(
        rewritten_definition,
        'when 3 then ''kartaview''',
        'when 3 then ''kartaview''' || chr(10) || '    when 4 then ''yfcc100m'''
      );
    end if;
    if rewritten_definition=original_definition then
      -- The manual apply workflow can be rerun. Once this migration has
      -- already rewritten a function, treating it as current is successful
      -- and avoids failing a retry of an otherwise idempotent deployment.
      if position('between 1 and 4' in lower(original_definition))=0
         or (
           function_row.proname='reserve_global_photo_candidate_v1'
           and position('when 4 then ''yfcc100m''' in lower(original_definition))=0
         )
      then
        raise exception 'could not extend provider validation for %', function_row.proname;
      end if;
      changed_count := changed_count + 1;
      continue;
    end if;
    execute rewritten_definition;
    changed_count := changed_count + 1;
  end loop;
  if changed_count < 3 then
    raise exception 'expected three canonical photo RPCs, updated %', changed_count;
  end if;
end $$;

-- Recovery lookup used when a worker crashes after finalizing the canonical
-- claim but before appending its Parquet metadata row. It returns only the
-- accepted registry record and is service-role-only.
create or replace function public.get_global_photo_candidate_v1(
  p_provider_code smallint,
  p_provider_asset_id text
)
returns table(
  candidate_status text,
  location_id uuid,
  content_sha256 text,
  storage_key text,
  normalized_source_url text
)
language sql
security definer
set search_path=''
as $$
  select
    r.status,
    r.location_id,
    case when r.content_sha256 is null then null else encode(r.content_sha256,'hex') end,
    r.storage_key,
    r.normalized_source_url
  from public.global_photo_candidate_registry r
  where r.provider_code=p_provider_code
    and r.provider_asset_id=trim(p_provider_asset_id)
  limit 1
$$;

revoke all on function public.get_global_photo_candidate_v1(smallint,text) from public,anon,authenticated;
grant execute on function public.get_global_photo_candidate_v1(smallint,text) to service_role;
