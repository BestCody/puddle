-- Read-only service-role probe for the on-demand media launch path.
-- This function reports whether migrations 10041 and 10042 are fully present
-- without claiming a location, reserving B2 bytes, or consuming Google budget.

create or replace function public.static_media_runtime_readiness_v1()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
begin
  if coalesce(auth.role()::text,'') <> 'service_role' then
    raise exception 'service role required';
  end if;

  return jsonb_build_object(
    'databaseBytes', pg_database_size(current_database()),
    'resolutionStateTableInstalled', to_regclass('public.static_media_resolution_states') is not null,
    'googleBudgetTableInstalled', to_regclass('public.static_google_runtime_budgets') is not null,
    'photoBudgetTableInstalled', to_regclass('public.static_photo_runtime_budget') is not null,
    'claimFunctionInstalled', to_regprocedure('public.claim_static_media_resolution_v1(text,uuid,text,text,integer,integer)') is not null,
    'finishFunctionInstalled', to_regprocedure('public.finish_static_media_resolution_v1(text,uuid,uuid,text,text)') is not null,
    'googleBudgetFunctionInstalled', to_regprocedure('public.consume_static_google_runtime_budget_v1(integer,integer)') is not null,
    'photoBudgetFunctionInstalled', to_regprocedure('public.reserve_static_photo_runtime_bytes_v1(bigint,bigint,bigint)') is not null,
    'databaseGuardInstalled', exists (
      select 1
      from pg_trigger trigger_row
      join pg_class table_row on table_row.oid = trigger_row.tgrelid
      join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
      where namespace_row.nspname = 'public'
        and table_row.relname = 'static_media_resolution_states'
        and trigger_row.tgname = 'static_media_resolution_database_size_guard'
        and not trigger_row.tgisinternal
        and trigger_row.tgenabled <> 'D'
    )
  );
end;
$$;

revoke all on function public.static_media_runtime_readiness_v1() from public,anon,authenticated;
grant execute on function public.static_media_runtime_readiness_v1() to service_role;

comment on function public.static_media_runtime_readiness_v1() is
  'Read-only service-role launch probe for on-demand static media tables, RPCs, database guard, and current database size.';
