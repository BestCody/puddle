-- Fail the migration gate when a public SQL/PLpgSQL function contains a direct
-- relation reference to a public table/view that no longer exists. Postgres can
-- retain stale PL/pgSQL bodies after a relation is dropped, so creation-time
-- validation alone is not sufficient for catalogue cutovers.

do $$
declare
  offenders text;
begin
  with funcs as (
    select
      p.oid,
      p.proname,
      pg_get_function_identity_arguments(p.oid) as args,
      lower(pg_get_functiondef(p.oid)) as body
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
  ), refs as (
    select distinct
      f.oid,
      f.proname,
      f.args,
      (match)[1] as relation_name
    from funcs f
    cross join lateral regexp_matches(
      f.body,
      E'\\m(?:from|join|update|into|delete[[:space:]]+from)[[:space:]]+public\\.([a-z_][a-z0-9_]*)',
      'g'
    ) as match
  ), existing as (
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
  )
  select string_agg(
    format('%s(%s) -> public.%s', r.proname, r.args, r.relation_name),
    E'\n'
    order by r.relation_name, r.proname, r.args
  )
  into offenders
  from refs r
  left join existing e on e.relname = r.relation_name
  where e.relname is null;

  if offenders is not null then
    raise exception E'public functions reference missing relations:\n%', offenders;
  end if;
end
$$;

select 'public function relation references are valid' as result;
