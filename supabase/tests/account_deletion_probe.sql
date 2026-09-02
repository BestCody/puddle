create temporary table cleanup_candidate_ids on commit drop as
select id
from auth.users
where lower(coalesce(email, '')) like '%@example.com';

select
  child_namespace.nspname as child_schema,
  child_table.relname as child_table,
  child_column.attname as child_column,
  parent_namespace.nspname as parent_schema,
  parent_table.relname as parent_table,
  constraint_row.conname,
  constraint_row.confdeltype,
  constraint_row.confupdtype
from pg_constraint constraint_row
join pg_class child_table on child_table.oid=constraint_row.conrelid
join pg_namespace child_namespace on child_namespace.oid=child_table.relnamespace
join pg_attribute child_column on child_column.attrelid=constraint_row.conrelid and child_column.attnum=constraint_row.conkey[1]
join pg_class parent_table on parent_table.oid=constraint_row.confrelid
join pg_namespace parent_namespace on parent_namespace.oid=parent_table.relnamespace
where constraint_row.contype='f'
  and constraint_row.confrelid in ('auth.users'::regclass,'public.profiles'::regclass)
  and array_length(constraint_row.conkey,1)=1
  and array_length(constraint_row.confkey,1)=1
order by parent_schema,parent_table,child_schema,child_table,child_column;

select
  trigger_relation.nspname as trigger_schema,
  trigger_table.relname as trigger_table,
  trigger_row.tgname,
  pg_get_triggerdef(trigger_row.oid) as trigger_definition
from pg_trigger trigger_row
join pg_class trigger_table on trigger_table.oid=trigger_row.tgrelid
join pg_namespace trigger_relation on trigger_relation.oid=trigger_table.relnamespace
where not trigger_row.tgisinternal
  and trigger_row.tgrelid in ('auth.users'::regclass,'public.profiles'::regclass)
order by trigger_relation.nspname,trigger_table.relname,trigger_row.tgname;

do $$
declare
  foreign_key record;
  matching_rows bigint;
begin
  for foreign_key in
    select
      child_namespace.nspname as child_schema,
      child_table.relname as child_table,
      child_column.attname as child_column,
      parent_namespace.nspname as parent_schema,
      parent_table.relname as parent_table,
      constraint_row.conname,
      constraint_row.confdeltype
    from pg_constraint constraint_row
    join pg_class child_table on child_table.oid=constraint_row.conrelid
    join pg_namespace child_namespace on child_namespace.oid=child_table.relnamespace
    join pg_attribute child_column on child_column.attrelid=constraint_row.conrelid and child_column.attnum=constraint_row.conkey[1]
    join pg_class parent_table on parent_table.oid=constraint_row.confrelid
    join pg_namespace parent_namespace on parent_namespace.oid=parent_table.relnamespace
    where constraint_row.contype='f'
      and constraint_row.confrelid in ('auth.users'::regclass,'public.profiles'::regclass)
      and array_length(constraint_row.conkey,1)=1
      and array_length(constraint_row.confkey,1)=1
  loop
    execute format(
      'select count(*) from %I.%I where %I in (select id from cleanup_candidate_ids)',
      foreign_key.child_schema,
      foreign_key.child_table,
      foreign_key.child_column
    ) into matching_rows;
    if matching_rows > 0 then
      raise notice 'candidate relation: %.% %.% -> %.% constraint=% delete=% rows=%',
        foreign_key.child_schema,
        foreign_key.child_table,
        foreign_key.child_column,
        foreign_key.parent_schema,
        foreign_key.parent_table,
        foreign_key.conname,
        foreign_key.confdeltype,
        matching_rows;
    end if;
  end loop;
end
$$;

do $$
declare
  target uuid;
begin
  select id into target
  from auth.users
  where lower(coalesce(email, '')) like 'puddle-ui-owner-%@example.com'
  order by created_at
  limit 1;
  if target is null then
    raise notice 'no disposable UI-owner probe account remains';
    return;
  end if;
  begin
    delete from auth.users where id=target;
    raise notice 'direct disposable Auth deletion succeeded';
  exception when others then
    raise notice 'direct disposable Auth deletion failed: sqlstate=% message=% detail=% hint=%',
      SQLSTATE,SQLERRM,coalesce(PG_EXCEPTION_DETAIL,''),coalesce(PG_EXCEPTION_HINT,'');
  end;
end
$$;
