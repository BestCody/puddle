-- Stage 9A: privileged roles, moderation cases, evidence, appeals, security events, rate limits, and scan queues.
create extension if not exists pgcrypto;

alter table public.profiles add column if not exists banned_at timestamptz;
alter table public.profiles add column if not exists ban_reason text;
alter table public.profiles add column if not exists moderation_state text not null default 'active';
alter table public.profiles add column if not exists risk_score integer not null default 0;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='profiles_moderation_state_check') then alter table public.profiles add constraint profiles_moderation_state_check check(moderation_state in('active','restricted','suspended','banned'));end if;
end $$;

alter table public.events add column if not exists delisted_at timestamptz;
alter table public.events add column if not exists moderation_hold_at timestamptz;
alter table public.events add column if not exists moderation_reason text;
alter table public.locations add column if not exists delisted_at timestamptz;
alter table public.locations add column if not exists moderation_hold_at timestamptz;
alter table public.locations add column if not exists moderation_reason text;
alter table public.host_profiles add column if not exists payout_frozen_at timestamptz;
alter table public.host_profiles add column if not exists payout_freeze_reason text;
alter table public.host_profiles add column if not exists delisted_at timestamptz;
alter table public.host_profiles add column if not exists moderation_state text not null default 'active';

do $$ begin
  if not exists(select 1 from pg_constraint where conname='host_profiles_moderation_state_check') then alter table public.host_profiles add constraint host_profiles_moderation_state_check check(moderation_state in('active','restricted','suspended'));end if;
end $$;

alter table public.conversations add column if not exists moderation_state text not null default 'active';
alter table public.conversations add column if not exists moderated_at timestamptz;
alter table public.conversations add column if not exists moderated_by uuid references public.profiles(id) on delete set null;
alter table public.conversations add column if not exists moderation_reason text;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='conversations_moderation_state_check') then alter table public.conversations add constraint conversations_moderation_state_check check(moderation_state in('active','restricted','closed'));end if;
end $$;

alter table public.messages add column if not exists moderator_removed_at timestamptz;
alter table public.messages add column if not exists moderator_removed_by uuid references public.profiles(id) on delete set null;
alter table public.messages add column if not exists moderator_reason text;
alter table public.social_comments add column if not exists moderator_removed_at timestamptz;
alter table public.social_comments add column if not exists moderator_removed_by uuid references public.profiles(id) on delete set null;
alter table public.social_comments add column if not exists moderator_reason text;
alter table public.media_assets add column if not exists evidence_hold_at timestamptz;
alter table public.media_assets add column if not exists malware_scan_provider text;
alter table public.media_assets add column if not exists malware_scan_result jsonb not null default '{}'::jsonb;
alter table public.media_assets add column if not exists scan_completed_at timestamptz;

alter table public.media_assets drop constraint if exists media_assets_scan_status_check;
alter table public.media_assets add constraint media_assets_scan_status_check check(scan_status in('pending','clean','infected','suspicious','error','failed','not_required'));


create table if not exists public.privileged_role_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_key text not null check(role_key in('super_admin','trust_safety','content_moderator','verification','support','finance_ops','security','incident_commander')),
  scope jsonb not null default '{}'::jsonb,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  reason text,
  unique(profile_id,role_key,granted_at)
);
create unique index if not exists privileged_role_active_unique on public.privileged_role_assignments(profile_id,role_key) where revoked_at is null;

create table if not exists public.moderation_sla_policies (
  category text primary key,
  low_minutes integer not null default 10080,
  normal_minutes integer not null default 2880,
  high_minutes integer not null default 720,
  urgent_minutes integer not null default 120,
  emergency_minutes integer not null default 15,
  updated_at timestamptz not null default now()
);
insert into public.moderation_sla_policies(category,low_minutes,normal_minutes,high_minutes,urgent_minutes,emergency_minutes) values
('default',10080,2880,720,120,15),('payments',4320,1440,240,60,15),('safety',1440,480,120,30,10),('verification',10080,4320,1440,240,30)
on conflict(category) do nothing;

create sequence if not exists public.moderation_case_number_seq;
create table if not exists public.moderation_cases (
  id uuid primary key default gen_random_uuid(),
  case_number text not null unique default ('PDL-'||to_char(now(),'YYYY')||'-'||lpad(nextval('public.moderation_case_number_seq')::text,8,'0')),
  title text not null check(char_length(title) between 3 and 240),
  summary text check(char_length(summary)<=4000),
  category text not null,
  priority text not null default 'normal' check(priority in('low','normal','high','urgent','emergency')),
  priority_rank integer not null default 2,
  state text not null default 'open' check(state in('open','triaged','investigating','waiting','actioned','resolved','dismissed','appealed','closed')),
  queue_key text not null default 'general',
  subject_type text not null,
  subject_id text not null,
  reporter_id uuid references public.profiles(id) on delete set null,
  source_report_type text,
  source_report_id text,
  assigned_to uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz,
  sla_due_at timestamptz,
  sla_breached_at timestamptz,
  emergency_escalated_at timestamptz,
  evidence_hold boolean not null default true,
  resolution_code text,
  resolution_note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists moderation_cases_queue_idx on public.moderation_cases(state,queue_key,priority_rank,sla_due_at,created_at);
create index if not exists moderation_cases_subject_idx on public.moderation_cases(subject_type,subject_id,created_at desc);

create table if not exists public.moderation_case_evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.moderation_cases(id) on delete restrict,
  source_type text not null,
  source_id text not null,
  snapshot jsonb not null,
  media_asset_id uuid references public.media_assets(id) on delete restrict,
  sha256 text not null,
  preserved_by uuid references public.profiles(id) on delete set null,
  preserved_at timestamptz not null default now(),
  retention_until timestamptz,
  legal_hold boolean not null default false,
  unique(case_id,source_type,source_id,sha256)
);

create table if not exists public.moderation_actions (
  id bigint generated always as identity primary key,
  case_id uuid not null references public.moderation_cases(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  reason text,
  before_data jsonb,
  after_data jsonb,
  request_id text,
  created_at timestamptz not null default now()
);
create index if not exists moderation_actions_case_idx on public.moderation_actions(case_id,created_at desc);

create table if not exists public.moderation_appeals (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.moderation_cases(id) on delete restrict,
  appellant_id uuid not null references public.profiles(id) on delete cascade,
  statement text not null check(char_length(statement) between 20 and 5000),
  state text not null default 'submitted' check(state in('submitted','assigned','reviewing','upheld','partially_upheld','overturned','closed')),
  assigned_to uuid references public.profiles(id) on delete set null,
  decision_reason text,
  decided_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique(case_id,appellant_id)
);

create table if not exists public.abuse_risk_signals (
  id bigint generated always as identity primary key,
  profile_id uuid references public.profiles(id) on delete cascade,
  host_profile_id uuid references public.host_profiles(id) on delete cascade,
  signal_type text not null,
  score_delta integer not null default 0,
  confidence numeric(5,4) not null default 0.5 check(confidence between 0 and 1),
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.linked_account_signals (
  id bigint generated always as identity primary key,
  profile_a uuid not null references public.profiles(id) on delete cascade,
  profile_b uuid not null references public.profiles(id) on delete cascade,
  signal_type text not null,
  confidence numeric(5,4) not null check(confidence between 0 and 1),
  signal_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check(profile_a<>profile_b),
  unique(profile_a,profile_b,signal_type,signal_hash)
);

create table if not exists public.security_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  severity text not null default 'info' check(severity in('info','notice','warning','high','critical')),
  target_type text,
  target_id text,
  request_id text,
  ip_hash text,
  device_hash text,
  user_agent_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- security_events was introduced in 0002 with a smaller authentication-audit schema.
-- Evolve that table explicitly because CREATE TABLE IF NOT EXISTS does not add columns.
alter table public.security_events add column if not exists actor_id uuid references public.profiles(id) on delete set null;
alter table public.security_events add column if not exists severity text not null default 'info';
alter table public.security_events add column if not exists target_type text;
alter table public.security_events add column if not exists target_id text;
alter table public.security_events add column if not exists request_id text;
alter table public.security_events add column if not exists ip_hash text;
alter table public.security_events add column if not exists device_hash text;
alter table public.security_events add column if not exists user_agent_hash text;
update public.security_events set actor_id=profile_id where actor_id is null and profile_id is not null;
create index if not exists security_events_actor_idx on public.security_events(actor_id,created_at desc);
create index if not exists security_events_type_idx on public.security_events(event_type,severity,created_at desc);

create table if not exists public.security_alerts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  severity text not null check(severity in('notice','warning','high','critical')),
  state text not null default 'open' check(state in('open','acknowledged','investigating','resolved','dismissed')),
  source_event_id bigint references public.security_events(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.system_notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  severity text not null default 'notice' check(severity in('notice','warning','critical')),
  audience text not null default 'all' check(audience in('all','authenticated','hosts','attendees','staff')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.security_audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  before_data jsonb,
  after_data jsonb,
  reason text,
  request_id text,
  ip_hash text,
  user_agent_hash text,
  created_at timestamptz not null default now(),
  previous_hash text,
  event_hash text not null
);

create table if not exists public.rate_limit_rules (
  id uuid primary key default gen_random_uuid(),
  action_name text not null,
  dimension_type text not null check(dimension_type in('ip','user','device','host','global')),
  window_seconds integer not null check(window_seconds between 1 and 86400),
  max_weight integer not null check(max_weight between 1 and 100000),
  block_seconds integer not null default 60 check(block_seconds between 1 and 604800),
  active boolean not null default true,
  unique(action_name,dimension_type,window_seconds)
);
create table if not exists public.rate_limit_counters (
  rule_id uuid not null references public.rate_limit_rules(id) on delete cascade,
  dimension_hash text not null,
  window_started_at timestamptz not null,
  weight integer not null default 0,
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key(rule_id,dimension_hash,window_started_at)
);
insert into public.rate_limit_rules(action_name,dimension_type,window_seconds,max_weight,block_seconds) values
('submit_report','user',3600,10,3600),('submit_report','ip',3600,30,3600),('submit_appeal','user',86400,3,86400),('ticket_checkout','user',900,15,900),('ticket_checkout','ip',900,40,900),('ticket_checkout','device',900,20,900),('ticket_checkout','host',900,200,900),('ticket_checkout','global',60,500,60),('media_upload','user',3600,50,3600),('media_upload','ip',3600,100,3600),('private_media_download','user',300,60,300),('admin_case_action','user',60,30,300),('admin_bulk_operation','user',3600,20,3600),('admin_role_change','user',3600,20,3600),('admin_notice_change','user',3600,30,3600),('csp_report','ip',300,100,900)
on conflict(action_name,dimension_type,window_seconds) do nothing;

create table if not exists public.media_scan_jobs (
  id bigint generated always as identity primary key,
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,
  status text not null default 'pending' check(status in('pending','processing','clean','infected','suspicious','error')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  scanner text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists media_scan_jobs_active_unique on public.media_scan_jobs(media_asset_id) where status in('pending','processing');
