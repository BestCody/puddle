\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

select 'auth.users', count(*) from auth.users;
select 'storage.objects', count(*) from storage.objects;
select 'storage.buckets', count(*) from storage.buckets;
select format('select %L, count(*) from %I.%I;',
              schemaname || '.' || tablename, schemaname, tablename)
from pg_tables
where schemaname = 'public'
order by schemaname, tablename
\gexec
