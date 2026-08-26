-- Make the access decision explicit for the three tables that are not product
-- entities. The save aggregates are worker-maintained internals; the PostGIS
-- reference table is public read-only reference data.

alter table if exists public.location_save_counts enable row level security;
alter table if exists public.location_save_density_tiles enable row level security;

-- The projections were retired from some hosted environments during the B2
-- cutover. Keep this migration safe in both shapes: enforce the decision when
-- a projection exists, and make its absence an explicit no-op.
do $$
begin
  if to_regclass('public.location_save_counts') is not null then
    execute 'revoke all on table public.location_save_counts from public, anon, authenticated';
    execute 'grant all on table public.location_save_counts to service_role';
    execute 'drop policy if exists location_save_counts_service_role_all on public.location_save_counts';
    execute 'create policy location_save_counts_service_role_all on public.location_save_counts for all to service_role using (true) with check (true)';
    execute 'comment on table public.location_save_counts is ''Internal save-count projection. RLS blocks client roles; service_role and owned SECURITY DEFINER workers maintain it.''';
  else
    raise notice 'location_save_counts is not installed; no RLS change required';
  end if;

  if to_regclass('public.location_save_density_tiles') is not null then
    execute 'revoke all on table public.location_save_density_tiles from public, anon, authenticated';
    execute 'grant all on table public.location_save_density_tiles to service_role';
    execute 'drop policy if exists location_save_density_tiles_service_role_all on public.location_save_density_tiles';
    execute 'create policy location_save_density_tiles_service_role_all on public.location_save_density_tiles for all to service_role using (true) with check (true)';
    execute 'comment on table public.location_save_density_tiles is ''Internal Pass heatmap projection. RLS blocks client roles; service_role and owned SECURITY DEFINER workers maintain it.''';
  else
    raise notice 'location_save_density_tiles is not installed; no RLS change required';
  end if;
end
$$;

-- spatial_ref_sys belongs to the PostGIS extension and is commonly owned by
-- supabase_admin rather than the migration role. A migration must not fail or
-- transfer ownership just to satisfy a generic advisor. When the migration
-- role is allowed to alter the extension table, apply the read-only policy;
-- otherwise the explicit decision is to leave ownership and grants under the
-- PostGIS administrator and record the exception for operator review.
do $$
declare
  table_owner text;
  migration_role_is_superuser boolean;
begin
  select pg_get_userbyid(c.relowner)
    into table_owner
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='spatial_ref_sys';

  select r.rolsuper
    into migration_role_is_superuser
  from pg_roles r
  where r.rolname=current_user;

  if table_owner is null then
    raise notice 'spatial_ref_sys is not installed; no RLS change required';
  elsif table_owner=current_user or coalesce(migration_role_is_superuser,false) then
    execute 'alter table if exists public.spatial_ref_sys enable row level security';
    execute 'revoke insert, update, delete, truncate, references, trigger on table public.spatial_ref_sys from public, anon, authenticated';
    execute 'grant select on table public.spatial_ref_sys to public';
    execute 'drop policy if exists spatial_ref_sys_read on public.spatial_ref_sys';
    execute 'create policy spatial_ref_sys_read on public.spatial_ref_sys for select to public using (true)';
    execute 'comment on table public.spatial_ref_sys is ''PostGIS coordinate-system reference data: readable by all roles, never writable by client roles.''';
  else
    raise notice 'spatial_ref_sys is extension-owned by %, so its RLS/grants remain an intentional PostGIS-managed exception', table_owner;
  end if;
end
$$;
