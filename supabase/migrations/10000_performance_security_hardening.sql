-- Performance and security hardening for interactive browser APIs.
-- These rules complement per-route CSRF, authentication, and row-level security checks.

insert into public.rate_limit_rules(action_name,dimension_type,window_seconds,max_weight,block_seconds) values
  ('draft_autosave','user',60,60,120),
  ('draft_autosave','ip',60,180,120),
  ('geocode_lookup','user',60,20,300),
  ('geocode_lookup','ip',60,60,300),
  ('discovery_action','user',60,120,120),
  ('discovery_action','ip',60,300,120)
on conflict(action_name,dimension_type,window_seconds) do update set
  max_weight=excluded.max_weight,
  block_seconds=excluded.block_seconds,
  active=true;

create index if not exists rate_limit_counters_updated_idx
  on public.rate_limit_counters(updated_at);

create or replace function public.prune_security_rate_limit_counters_v1(retain_for interval default interval '2 days')
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare removed integer;
begin
  if auth.role()<>'service_role' and not public.has_privileged_role_v1(array['super_admin','security']) then
    raise exception 'service or security access required';
  end if;
  delete from public.rate_limit_counters
  where updated_at < now() - greatest(retain_for, interval '1 hour');
  get diagnostics removed = row_count;
  return removed;
end
$$;

revoke execute on function public.prune_security_rate_limit_counters_v1(interval) from public,anon,authenticated;
grant execute on function public.prune_security_rate_limit_counters_v1(interval) to service_role;
