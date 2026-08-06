-- Service-role-only coordination and hard runtime budgets for resolving media on
-- the currently visible static catalogue card. The feature remains disabled
-- unless the deployment explicitly enables it.

create table if not exists public.static_media_resolution_states (
  release text not null check (char_length(release) between 3 and 80),
  static_location_id uuid not null,
  source text not null check (source in ('overture','fsq_os')),
  source_place_id text not null check (char_length(source_place_id) between 1 and 240),
  state text not null default 'pending' check (state in (
    'pending','resolving','open_photo_found','google_matched','no_match','temporary_failure'
  )),
  lease_token uuid,
  lease_expires_at timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 3),
  last_error text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (release, static_location_id),
  unique (release, source, source_place_id)
);

create index if not exists static_media_resolution_retry_idx
  on public.static_media_resolution_states(updated_at)
  where state in ('pending','resolving','temporary_failure');

create table if not exists public.static_google_runtime_budgets (
  bucket_type text not null check (bucket_type in ('day','month')),
  bucket_start date not null,
  requests_used integer not null default 0 check (requests_used >= 0),
  updated_at timestamptz not null default now(),
  primary key (bucket_type, bucket_start)
);

create table if not exists public.static_photo_runtime_budget (
  singleton boolean primary key default true check (singleton),
  baseline_bytes bigint not null default 0 check (baseline_bytes >= 0),
  reserved_bytes bigint not null default 0 check (reserved_bytes >= 0),
  updated_at timestamptz not null default now()
);

alter table public.static_media_resolution_states enable row level security;
alter table public.static_google_runtime_budgets enable row level security;
alter table public.static_photo_runtime_budget enable row level security;

revoke all on table public.static_media_resolution_states from public,anon,authenticated;
revoke all on table public.static_google_runtime_budgets from public,anon,authenticated;
revoke all on table public.static_photo_runtime_budget from public,anon,authenticated;
grant select,insert,update,delete on table public.static_media_resolution_states to service_role;
grant select,insert,update,delete on table public.static_google_runtime_budgets to service_role;
grant select,insert,update,delete on table public.static_photo_runtime_budget to service_role;

comment on table public.static_media_resolution_states is
  'Idempotent service-role-only leases and terminal outcomes for visible-card static media resolution.';
comment on table public.static_google_runtime_budgets is
  'Atomic UTC daily and monthly Google Places request counters with hard caps enforced by RPC.';
comment on table public.static_photo_runtime_budget is
  'Conservative B2 byte reservations above an operator-supplied measured bucket baseline.';

create or replace function public.claim_static_media_resolution_v1(
  release_value text,
  target_static_location uuid,
  import_source text,
  import_source_place_id text,
  lease_seconds integer default 90,
  retry_after_seconds integer default 3600
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  current_row public.static_media_resolution_states%rowtype;
  next_token uuid := gen_random_uuid();
  now_value timestamptz := now();
  safe_lease integer := greatest(30, least(coalesce(lease_seconds,90), 300));
  safe_retry integer := greatest(300, least(coalesce(retry_after_seconds,3600), 86400));
begin
  if coalesce(auth.role()::text,'') <> 'service_role' then raise exception 'service role required'; end if;
  if release_value !~ '^[a-z0-9][a-z0-9-]{2,79}$' then raise exception 'invalid release'; end if;
  if target_static_location is null then raise exception 'static location id is required'; end if;
  if import_source not in ('overture','fsq_os') then raise exception 'unsupported catalogue source'; end if;
  if nullif(trim(import_source_place_id),'') is null or char_length(import_source_place_id)>240 then raise exception 'invalid source place id'; end if;

  insert into public.static_media_resolution_states(
    release,static_location_id,source,source_place_id,state,lease_token,lease_expires_at,attempts,updated_at
  ) values (
    release_value,target_static_location,import_source,import_source_place_id,
    'resolving',next_token,now_value + make_interval(secs=>safe_lease),1,now_value
  )
  on conflict (release,static_location_id) do nothing;

  select * into current_row
  from public.static_media_resolution_states
  where release=release_value and static_location_id=target_static_location
  for update;

  if current_row.lease_token=next_token then
    return jsonb_build_object('claimed',true,'token',next_token,'state','resolving','attempts',1);
  end if;

  if current_row.state in ('open_photo_found','google_matched','no_match') then
    return jsonb_build_object('claimed',false,'state',current_row.state,'attempts',current_row.attempts);
  end if;

  if current_row.state='resolving' and current_row.lease_expires_at>now_value then
    return jsonb_build_object('claimed',false,'state','resolving','attempts',current_row.attempts);
  end if;

  if current_row.state='temporary_failure' and current_row.updated_at>now_value - make_interval(secs=>safe_retry) then
    return jsonb_build_object('claimed',false,'state','temporary_failure','attempts',current_row.attempts);
  end if;

  if current_row.attempts>=3 then
    update public.static_media_resolution_states
    set state='no_match',lease_token=null,lease_expires_at=null,resolved_at=coalesce(resolved_at,now_value),updated_at=now_value
    where release=release_value and static_location_id=target_static_location;
    return jsonb_build_object('claimed',false,'state','no_match','attempts',current_row.attempts);
  end if;

  update public.static_media_resolution_states
  set source=import_source,
      source_place_id=import_source_place_id,
      state='resolving',
      lease_token=next_token,
      lease_expires_at=now_value + make_interval(secs=>safe_lease),
      attempts=current_row.attempts+1,
      last_error=null,
      updated_at=now_value
  where release=release_value and static_location_id=target_static_location;

  return jsonb_build_object('claimed',true,'token',next_token,'state','resolving','attempts',current_row.attempts+1);
end;
$$;

create or replace function public.finish_static_media_resolution_v1(
  release_value text,
  target_static_location uuid,
  claim_token uuid,
  final_state text,
  error_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  affected integer;
  terminal boolean := final_state in ('open_photo_found','google_matched','no_match');
begin
  if coalesce(auth.role()::text,'') <> 'service_role' then raise exception 'service role required'; end if;
  if final_state not in ('open_photo_found','google_matched','no_match','temporary_failure') then raise exception 'invalid resolution state'; end if;

  update public.static_media_resolution_states
  set state=final_state,
      lease_token=null,
      lease_expires_at=null,
      last_error=nullif(left(coalesce(error_value,''),500),''),
      resolved_at=case when terminal then now() else null end,
      updated_at=now()
  where release=release_value
    and static_location_id=target_static_location
    and lease_token=claim_token;
  get diagnostics affected = row_count;
  return jsonb_build_object('updated',affected=1,'state',final_state);
end;
$$;

create or replace function public.consume_static_google_runtime_budget_v1(
  daily_limit integer,
  monthly_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  day_start date := (now() at time zone 'UTC')::date;
  month_start date := date_trunc('month',now() at time zone 'UTC')::date;
  safe_daily integer := greatest(0,least(coalesce(daily_limit,0),500));
  safe_monthly integer := greatest(0,least(coalesce(monthly_limit,0),5000));
  day_used integer;
  month_used integer;
begin
  if coalesce(auth.role()::text,'') <> 'service_role' then raise exception 'service role required'; end if;
  insert into public.static_google_runtime_budgets(bucket_type,bucket_start) values ('day',day_start) on conflict do nothing;
  insert into public.static_google_runtime_budgets(bucket_type,bucket_start) values ('month',month_start) on conflict do nothing;

  select requests_used into day_used from public.static_google_runtime_budgets
    where bucket_type='day' and bucket_start=day_start for update;
  select requests_used into month_used from public.static_google_runtime_budgets
    where bucket_type='month' and bucket_start=month_start for update;

  if safe_daily=0 or safe_monthly=0 or day_used>=safe_daily or month_used>=safe_monthly then
    return jsonb_build_object(
      'allowed',false,'dailyUsed',day_used,'dailyLimit',safe_daily,
      'monthlyUsed',month_used,'monthlyLimit',safe_monthly
    );
  end if;

  update public.static_google_runtime_budgets set requests_used=requests_used+1,updated_at=now()
    where bucket_type='day' and bucket_start=day_start;
  update public.static_google_runtime_budgets set requests_used=requests_used+1,updated_at=now()
    where bucket_type='month' and bucket_start=month_start;

  return jsonb_build_object(
    'allowed',true,'dailyUsed',day_used+1,'dailyLimit',safe_daily,
    'monthlyUsed',month_used+1,'monthlyLimit',safe_monthly
  );
end;
$$;

create or replace function public.reserve_static_photo_runtime_bytes_v1(
  baseline_bytes_value bigint,
  reserve_bytes_value bigint,
  maximum_bytes_value bigint
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  row_value public.static_photo_runtime_budget%rowtype;
  safe_baseline bigint := greatest(0,coalesce(baseline_bytes_value,0));
  safe_reserve bigint := greatest(1,least(coalesce(reserve_bytes_value,0),1000000));
  safe_maximum bigint := greatest(1,least(coalesce(maximum_bytes_value,0),9000000000));
  projected bigint;
begin
  if coalesce(auth.role()::text,'') <> 'service_role' then raise exception 'service role required'; end if;
  if safe_baseline<=0 then raise exception 'a measured positive B2 baseline is required'; end if;
  if safe_baseline>safe_maximum then
    return jsonb_build_object('allowed',false,'reason','baseline_exceeds_maximum','projectedBytes',safe_baseline);
  end if;

  insert into public.static_photo_runtime_budget(singleton,baseline_bytes,reserved_bytes)
    values (true,safe_baseline,0) on conflict(singleton) do nothing;
  select * into row_value from public.static_photo_runtime_budget where singleton=true for update;

  if safe_baseline>row_value.baseline_bytes then
    row_value.baseline_bytes := safe_baseline;
  end if;
  projected := row_value.baseline_bytes + row_value.reserved_bytes + safe_reserve;
  if projected>safe_maximum then
    update public.static_photo_runtime_budget set baseline_bytes=row_value.baseline_bytes,updated_at=now() where singleton=true;
    return jsonb_build_object('allowed',false,'reason','photo_storage_budget_exhausted','projectedBytes',projected,'maximumBytes',safe_maximum);
  end if;

  update public.static_photo_runtime_budget
  set baseline_bytes=row_value.baseline_bytes,
      reserved_bytes=row_value.reserved_bytes+safe_reserve,
      updated_at=now()
  where singleton=true;
  return jsonb_build_object('allowed',true,'projectedBytes',projected,'maximumBytes',safe_maximum,'reservedBytes',row_value.reserved_bytes+safe_reserve);
end;
$$;

revoke all on function public.claim_static_media_resolution_v1(text,uuid,text,text,integer,integer) from public,anon,authenticated;
revoke all on function public.finish_static_media_resolution_v1(text,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.consume_static_google_runtime_budget_v1(integer,integer) from public,anon,authenticated;
revoke all on function public.reserve_static_photo_runtime_bytes_v1(bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.claim_static_media_resolution_v1(text,uuid,text,text,integer,integer) to service_role;
grant execute on function public.finish_static_media_resolution_v1(text,uuid,uuid,text,text) to service_role;
grant execute on function public.consume_static_google_runtime_budget_v1(integer,integer) to service_role;
grant execute on function public.reserve_static_photo_runtime_bytes_v1(bigint,bigint,bigint) to service_role;