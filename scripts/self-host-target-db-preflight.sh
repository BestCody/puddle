#!/usr/bin/env bash
set -euo pipefail

docker exec supabase-db psql -U postgres -d postgres -X -A -t -v ON_ERROR_STOP=1 \
  -c "select 'version|' || current_setting('server_version') union all select 'auth_users|' || count(*) from auth.users union all select 'storage_objects|' || count(*) from storage.objects;"
docker exec supabase-db psql -U postgres -d postgres -X -A -t -v ON_ERROR_STOP=1 \
  -c "select 'extension|' || extname || '|' || extversion from pg_extension order by extname;"
docker exec supabase-db psql -U postgres -d postgres -X -A -t -v ON_ERROR_STOP=1 \
  -c "select 'available|' || name || '|' || default_version from pg_available_extensions where name in ('postgis', 'vector') order by name;"
docker exec supabase-db psql -U postgres -d postgres -X -A -t -v ON_ERROR_STOP=1 \
  -c "select 'role|' || rolname || '|superuser=' || rolsuper || '|create_role=' || rolcreaterole from pg_roles where rolname in ('postgres', 'supabase_admin') order by rolname;"
docker exec supabase-db psql -U postgres -d postgres -X -A -t -v ON_ERROR_STOP=1 \
  -c "select 'system_table|' || table_schema || '.' || table_name from information_schema.tables where table_schema in ('auth', 'storage') and table_type = 'BASE TABLE' order by 1;"
docker exec supabase-db psql -U postgres -d postgres -X -A -t -v ON_ERROR_STOP=1 \
  -c "select 'auth_schema_migrations|' || count(*) from auth.schema_migrations union all select 'storage_migrations|' || count(*) from storage.migrations union all select 'auth_instances|' || count(*) from auth.instances union all select 'storage_buckets|' || count(*) from storage.buckets;"
