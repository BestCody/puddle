-- Stage 5A: Stripe Connect identity, commercial catalog, orders, refunds, payouts, and immutable ledger.
-- Apply after 0018_stage8_hardening.sql.

create table if not exists public.stripe_connected_accounts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  stripe_account_id text not null unique check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  account_type text not null default 'express' check (account_type in ('express','custom','standard')),
  country char(2),
  details_submitted boolean not null default false,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  identity_status text not null default 'pending' check (identity_status in ('pending','submitted','verified','restricted','rejected')),
  payout_status text not null default 'pending' check (payout_status in ('pending','enabled','paused','restricted','failed')),
  requirements_due text[] not null default '{}',
  disabled_reason text,
  fraud_hold boolean not null default false,
  fraud_hold_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stripe_connected_accounts_readiness_idx on public.stripe_connected_accounts(charges_enabled,payouts_enabled,fraud_hold);

create table if not exists public.payment_configuration (
  singleton boolean primary key default true check (singleton),
  platform_fee_bps integer not null default 500 check (platform_fee_bps between 0 and 10000),
  fixed_fee_cents integer not null default 0 check (fixed_fee_cents between 0 and 100000),
  default_currency char(3) not null default 'CAD',
  reservation_minutes integer not null default 30 check (reservation_minutes between 30 and 1440),
  default_refund_window_hours integer not null default 48 check (default_refund_window_hours between 0 and 8760),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.payment_configuration(singleton) values(true) on conflict(singleton) do nothing;

alter table public.events add column if not exists payout_profile_id uuid references public.profiles(id) on delete set null;
alter table public.events add column if not exists paid_ticketing_enabled boolean not null default false;
alter table public.events add column if not exists fee_policy jsonb not null default '{}'::jsonb;
alter table public.events add column if not exists refund_policy text;
update public.events set payout_profile_id=created_by where payout_profile_id is null;
create index if not exists events_payout_profile_idx on public.events(payout_profile_id) where paid_ticketing_enabled;

alter table public.ticket_types add column if not exists description text check (description is null or char_length(description)<=500);
alter table public.ticket_types add column if not exists currency char(3) not null default 'CAD';
alter table public.ticket_types add column if not exists status text not null default 'active';
alter table public.ticket_types add column if not exists min_per_order integer not null default 1;
alter table public.ticket_types add column if not exists max_per_order integer not null default 6;
alter table public.ticket_types add column if not exists per_customer_limit integer not null default 10;
alter table public.ticket_types add column if not exists tax_code text;
alter table public.ticket_types add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.ticket_types add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.ticket_types add column if not exists created_at timestamptz not null default now();
alter table public.ticket_types add column if not exists updated_at timestamptz not null default now();
alter table public.ticket_types drop constraint if exists ticket_types_status_check;
alter table public.ticket_types add constraint ticket_types_status_check check(status in ('draft','active','paused','sold_out','archived'));
alter table public.ticket_types drop constraint if exists ticket_types_order_limits_check;
alter table public.ticket_types add constraint ticket_types_order_limits_check check(min_per_order between 1 and 20 and max_per_order between min_per_order and 20 and per_customer_limit between 1 and 100);
create index if not exists ticket_types_public_sales_idx on public.ticket_types(event_id,status,sales_start,sales_end);

create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9_-]{3,32}$'),
  percent_off integer check (percent_off between 1 and 100),
  amount_off_cents integer check (amount_off_cents > 0),
  currency char(3) not null default 'CAD',
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  per_customer_limit integer not null default 1 check (per_customer_limit between 1 and 100),
  active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(percent_off,amount_off_cents)=1),
  check (ends_at is null or starts_at is null or ends_at>starts_at),
  unique(event_id,code)
);
create index if not exists promo_codes_lookup_idx on public.promo_codes(event_id,code) where active;

alter table public.orders add column if not exists host_profile_id uuid references public.host_profiles(id) on delete set null;
alter table public.orders add column if not exists payout_profile_id uuid references public.profiles(id) on delete set null;
alter table public.orders add column if not exists promo_code_id uuid references public.promo_codes(id) on delete set null;
alter table public.orders add column if not exists stripe_payment_intent_id text unique;
alter table public.orders add column if not exists stripe_charge_id text unique;
alter table public.orders add column if not exists stripe_transfer_id text;
alter table public.orders add column if not exists stripe_application_fee_id text;
alter table public.orders add column if not exists receipt_url text;
alter table public.orders add column if not exists subtotal_cents integer not null default 0;
alter table public.orders add column if not exists discount_cents integer not null default 0;
alter table public.orders add column if not exists tax_cents integer not null default 0;
alter table public.orders add column if not exists platform_fee_cents integer not null default 0;
alter table public.orders add column if not exists refund_total_cents integer not null default 0;
alter table public.orders add column if not exists dispute_total_cents integer not null default 0;
alter table public.orders add column if not exists idempotency_key uuid;
alter table public.orders add column if not exists expires_at timestamptz;
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists cancelled_at timestamptz;
alter table public.orders add column if not exists fraud_hold_reason text;
alter table public.orders add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.orders add column if not exists updated_at timestamptz not null default now();
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check(status in ('pending','checkout_created','payment_processing','paid','payment_review','payment_failed','partially_refunded','refunded','disputed','fraud_hold','cancelled','expired'));
alter table public.orders drop constraint if exists orders_amounts_check;
alter table public.orders add constraint orders_amounts_check check(subtotal_cents>=0 and discount_cents>=0 and tax_cents>=0 and platform_fee_cents>=0 and amount_total_cents>=0 and refund_total_cents>=0 and dispute_total_cents>=0 and discount_cents<=subtotal_cents and refund_total_cents<=amount_total_cents);
create unique index if not exists orders_buyer_idempotency_unique on public.orders(buyer_id,idempotency_key) where idempotency_key is not null;
create index if not exists orders_event_status_idx on public.orders(event_id,status,created_at desc);
create index if not exists orders_buyer_status_idx on public.orders(buyer_id,status,created_at desc);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  ticket_type_id uuid not null references public.ticket_types(id) on delete restrict,
  name text not null,
  description text,
  quantity integer not null check (quantity between 1 and 20),
  unit_amount_cents integer not null check (unit_amount_cents>=0),
  subtotal_cents integer not null check (subtotal_cents>=0),
  discount_cents integer not null default 0 check (discount_cents>=0),
  tax_cents integer not null default 0 check (tax_cents>=0),
  total_cents integer not null check (total_cents>=0),
  currency char(3) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(order_id,ticket_type_id)
);
create index if not exists order_items_ticket_type_idx on public.order_items(ticket_type_id,order_id);

alter table public.inventory_reservations add column if not exists order_id uuid references public.orders(id) on delete cascade;
alter table public.inventory_reservations add column if not exists status text not null default 'held';
alter table public.inventory_reservations add column if not exists idempotency_key uuid;
alter table public.inventory_reservations add column if not exists updated_at timestamptz not null default now();
alter table public.inventory_reservations drop constraint if exists inventory_reservations_status_check;
alter table public.inventory_reservations add constraint inventory_reservations_status_check check(status in ('held','consumed','released','expired'));
create unique index if not exists inventory_reservations_order_tier_unique on public.inventory_reservations(order_id,ticket_type_id) where order_id is not null;
create index if not exists inventory_reservations_active_idx on public.inventory_reservations(ticket_type_id,expires_at) where status='held';

create table if not exists public.promo_redemptions (
  id bigint generated always as identity primary key,
  promo_code_id uuid not null references public.promo_codes(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  discount_cents integer not null check(discount_cents>0),
  created_at timestamptz not null default now()
);
create index if not exists promo_redemptions_profile_idx on public.promo_redemptions(promo_code_id,profile_id);

create table if not exists public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  requester_id uuid not null references public.profiles(id) on delete restrict,
  amount_cents integer not null check(amount_cents>0),
  currency char(3) not null,
  reason text not null check(char_length(reason) between 3 and 1000),
  status text not null default 'requested' check(status in ('requested','approved','declined','processing','pending','succeeded','failed','cancelled')),
  stripe_refund_id text unique,
  decided_by uuid references public.profiles(id) on delete set null,
  decision_note text,
  failure_reason text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists refund_requests_order_idx on public.refund_requests(order_id,status,requested_at desc);

create table if not exists public.stripe_webhook_events (
  id bigint generated always as identity primary key,
  stripe_event_id text not null unique,
  event_type text not null,
  livemode boolean not null,
  connected_account_id text,
  api_version text,
  created_at_stripe timestamptz,
  payload jsonb not null,
  status text not null default 'pending' check(status in ('pending','processing','processed','failed','ignored')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  last_error text,
  received_at timestamptz not null default now()
);
create index if not exists stripe_webhook_work_idx on public.stripe_webhook_events(status,next_attempt_at,id);

create table if not exists public.stripe_disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  stripe_dispute_id text not null unique,
  stripe_charge_id text not null,
  amount_cents integer not null check(amount_cents>=0),
  currency char(3) not null,
  status text not null,
  reason text,
  evidence_due_at timestamptz,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  last_stripe_event_id text
);
create index if not exists stripe_disputes_order_idx on public.stripe_disputes(order_id,status);

create table if not exists public.stripe_payouts (
  id uuid primary key default gen_random_uuid(),
  payout_profile_id uuid references public.profiles(id) on delete set null,
  stripe_account_id text,
  stripe_payout_id text not null unique,
  amount_cents integer not null check(amount_cents>=0),
  currency char(3) not null,
  status text not null check(status in ('pending','in_transit','paid','failed','cancelled')),
  arrival_at timestamptz,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_stripe_event_id text
);
create index if not exists stripe_payouts_profile_idx on public.stripe_payouts(payout_profile_id,status,created_at desc);

create table if not exists public.ledger_journals (
  id uuid primary key default gen_random_uuid(),
  journal_type text not null check(journal_type in ('order_paid','refund','dispute','dispute_reversal','payout','payout_failure','adjustment')),
  order_id uuid references public.orders(id) on delete restrict,
  refund_request_id uuid references public.refund_requests(id) on delete restrict,
  dispute_id uuid references public.stripe_disputes(id) on delete restrict,
  payout_id uuid references public.stripe_payouts(id) on delete restrict,
  stripe_event_id text,
  currency char(3) not null,
  description text not null,
  created_at timestamptz not null default now(),
  unique(journal_type,stripe_event_id)
);
create table if not exists public.ledger_entries (
  id bigint generated always as identity primary key,
  journal_id uuid not null references public.ledger_journals(id) on delete restrict,
  account_code text not null check(account_code in ('stripe_cash','seller_payable','platform_fee_revenue','tax_payable','refunds','disputes','external_payout','processor_fee','adjustment')),
  profile_id uuid references public.profiles(id) on delete set null,
  amount_cents bigint not null check(amount_cents<>0),
  created_at timestamptz not null default now()
);
create index if not exists ledger_entries_profile_idx on public.ledger_entries(profile_id,account_code,created_at desc);

create or replace function public.protect_immutable_financial_rows() returns trigger language plpgsql set search_path=public as $$begin raise exception 'financial audit rows are append-only';end$$;
drop trigger if exists ledger_journals_immutable on public.ledger_journals;
create trigger ledger_journals_immutable before update or delete on public.ledger_journals for each row execute function public.protect_immutable_financial_rows();
drop trigger if exists ledger_entries_immutable on public.ledger_entries;
create trigger ledger_entries_immutable before update or delete on public.ledger_entries for each row execute function public.protect_immutable_financial_rows();

create table if not exists public.reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  started_by uuid references public.profiles(id) on delete set null,
  mode text not null default 'automated' check(mode in ('automated','manual','test')),
  status text not null default 'running' check(status in ('running','balanced','differences','failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  error_message text
);
create table if not exists public.reconciliation_items (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.reconciliation_runs(id) on delete cascade,
  item_type text not null,
  local_reference text,
  stripe_reference text,
  expected_cents bigint,
  actual_cents bigint,
  status text not null check(status in ('matched','missing_local','missing_stripe','amount_mismatch','status_mismatch')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
