-- Run read-only via psql on BOTH source and destination and compare output.
-- A successful restore must also pass the application's authenticated E2E tests.
\set ON_ERROR_STOP on

select current_setting('server_version') as postgres_version;
select extname, extversion from pg_extension order by extname;
select count(*) as auth_users from auth.users;
select count(*) as storage_objects from storage.objects;
select id, name, public from storage.buckets order by id;
select pubname, puballtables from pg_publication order by pubname;
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by schemaname, tablename;
select schemaname, tablename
from pg_tables
where schemaname = 'public'
order by tablename;
-- Generate safely quoted, read-only exact counts for every public base table.
-- Run on both databases after the write freeze and compare each result.
select format('select %L as table_name, count(*) as row_count from %I.%I;',
              schemaname || '.' || tablename, schemaname, tablename)
from pg_tables
where schemaname = 'public'
order by schemaname, tablename
\gexec
select n.nspname as schema_name, c.relname as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'storage')
  and c.relkind in ('r', 'p')
  and not c.relrowsecurity
order by n.nspname, c.relname;
