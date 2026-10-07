\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
set search_path to pg_catalog, public;

select 'rls', n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
order by n.nspname, c.relname;

select 'policy', schemaname, tablename, policyname, permissive, roles, cmd,
       coalesce(qual, ''), coalesce(with_check, '')
from pg_policies
where schemaname = 'public'
order by schemaname, tablename, policyname;

select 'bucket', id, name, public
from storage.buckets
order by id;
