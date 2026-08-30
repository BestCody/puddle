-- Account deletion must not be blocked by historical attribution rows. Keep
-- durable records such as orders, moderation history, and check-in history,
-- but remove their relationship to a deleted profile.
do $$
declare
  foreign_key record;
begin
  for foreign_key in
    select
      child_namespace.nspname as child_schema,
      child_table.relname as child_table,
      constraint_row.conname,
      child_column.attname as child_column,
      child_column.attnotnull
    from pg_constraint constraint_row
    join pg_class child_table on child_table.oid=constraint_row.conrelid
    join pg_namespace child_namespace on child_namespace.oid=child_table.relnamespace
    join pg_attribute child_column on child_column.attrelid=constraint_row.conrelid and child_column.attnum=constraint_row.conkey[1]
    where constraint_row.contype='f'
      and constraint_row.confrelid='public.profiles'::regclass
      and constraint_row.confdeltype in ('a','r')
      and array_length(constraint_row.conkey,1)=1
      and array_length(constraint_row.confkey,1)=1
      and constraint_row.confkey[1]=(
        select parent_column.attnum
        from pg_attribute parent_column
        where parent_column.attrelid='public.profiles'::regclass
          and parent_column.attname='id'
      )
      and child_namespace.nspname='public'
  loop
    execute format('alter table %I.%I drop constraint %I', foreign_key.child_schema, foreign_key.child_table, foreign_key.conname);
    if foreign_key.attnotnull then
      execute format('alter table %I.%I alter column %I drop not null', foreign_key.child_schema, foreign_key.child_table, foreign_key.child_column);
    end if;
    execute format(
      'alter table %I.%I add constraint %I foreign key (%I) references public.profiles(id) on delete set null',
      foreign_key.child_schema,
      foreign_key.child_table,
      foreign_key.conname,
      foreign_key.child_column
    );
  end loop;
end
$$;
