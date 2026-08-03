create table if not exists public.discovery_context_outbox (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null,
  location_id uuid not null references public.locations(id) on delete cascade,
  event_name text,
  context_mode text not null default 'solo',
  context_category text,
  context_payload jsonb not null default '{}'::jsonb,
  touch_reason text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(profile_id,event_id)
);
create index if not exists discovery_context_outbox_ready_idx
  on public.discovery_context_outbox(id)
  where processed_at is null;
alter table public.discovery_context_outbox enable row level security;
revoke all on table public.discovery_context_outbox from public,anon,authenticated;
grant select,insert,update,delete on table public.discovery_context_outbox to service_role;
