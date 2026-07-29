-- Run after migrations 0019 through 0023 in a non-production Supabase project.
do $$
declare missing text[];definition text;
begin
  select array_agg(name) into missing from (values('stripe_connected_accounts'),('promo_codes'),('order_items'),('refund_requests'),('stripe_webhook_events'),('stripe_disputes'),('stripe_payouts'),('ledger_journals'),('ledger_entries'),('ticket_transfers'),('ticket_checkin_events'))v(name) where not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=v.name and c.relkind='r');
  if missing is not null then raise exception 'Missing Stage 5 tables: %',missing; end if;
  if exists(select 1 from (values('stripe_connected_accounts'),('ticket_types'),('promo_codes'),('inventory_reservations'),('order_items'),('refund_requests'),('stripe_webhook_events'),('stripe_disputes'),('stripe_payouts'),('ledger_journals'),('ledger_entries'),('ticket_transfers'),('ticket_checkin_events'))v(name) join pg_class c on c.relname=v.name join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not c.relrowsecurity) then raise exception 'Stage 5 RLS is not enabled'; end if;
  if has_table_privilege('authenticated','public.stripe_webhook_events','SELECT') or has_table_privilege('authenticated','public.ledger_entries','INSERT') or has_table_privilege('authenticated','public.inventory_reservations','INSERT') then raise exception 'Authenticated clients can access worker-only financial rows'; end if;
  if not has_function_privilege('anon','public.public_ticket_tiers_v1(uuid)','EXECUTE') then raise exception 'Public ticket inventory RPC is unavailable'; end if;
  if has_function_privilege('anon','public.reserve_paid_order_v1(uuid,jsonb,text,uuid)','EXECUTE') then raise exception 'Anonymous clients can reserve paid orders'; end if;
  if has_function_privilege('authenticated','public.fulfill_paid_order_v1(uuid,text,text,text,integer,text,text,text)','EXECUTE') then raise exception 'Authenticated clients can fulfill paid orders'; end if;
  if has_function_privilege('authenticated','public.claim_stripe_webhook_events_v1(integer)','EXECUTE') then raise exception 'Authenticated clients can claim Stripe webhooks'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='orders_buyer_idempotency_unique') then raise exception 'Order idempotency index is missing'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='stripe_webhook_events_stripe_event_id_key') and not exists(select 1 from pg_constraint where conname='stripe_webhook_events_stripe_event_id_key') then raise exception 'Stripe webhook replay protection is missing'; end if;
  if not exists(select 1 from pg_trigger where tgname='ledger_entries_immutable' and not tgisinternal) then raise exception 'Ledger immutability trigger is missing'; end if;
  if not exists(select 1 from pg_trigger where tgname='ticket_checkin_events_immutable' and not tgisinternal) then raise exception 'Check-in audit immutability trigger is missing'; end if;
  select pg_get_functiondef('public.request_event_publication(uuid)'::regprocedure) into definition;
  if definition not ilike '%charges_enabled%' or definition not ilike '%payouts_enabled%' or definition not ilike '%active paid ticket tier%' then raise exception 'Paid publishing is not gated by Stripe readiness and inventory'; end if;
  select pg_get_functiondef('public.fulfill_paid_order_v1(uuid,text,text,text,integer,text,text,text)'::regprocedure) into definition;
  if definition not ilike '%service role required%' or definition not ilike '%payment_review%' or definition not ilike '%tickets_issued%' then raise exception 'Webhook-only fulfillment hardening is incomplete'; end if;
  select pg_get_functiondef('public.check_in_ticket_v1(uuid,uuid,integer,text,text,uuid,timestamptz,boolean,text)'::regprocedure) into definition;
  if definition not ilike '%duplicate%' or definition not ilike '%token_version%' then raise exception 'Duplicate or replaced-ticket check-in protection is incomplete'; end if;
end$$;
