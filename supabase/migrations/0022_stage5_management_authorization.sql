-- Stage 5D: creator controls, paid-publication gate, dashboards, RLS, and execution grants.
-- Apply after 0021_stage5_fulfillment_tickets_checkin.sql.

create or replace function public.upsert_ticket_tier_v1(target_event uuid,target_tier uuid,tier_name text,tier_description text,tier_price integer,tier_quantity integer,tier_max_per_order integer,tier_customer_limit integer,sales_start_value timestamptz,sales_end_value timestamptz)
returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid;existing public.ticket_types%rowtype;e public.events%rowtype;
begin
  if not public.can_manage_event(target_event) then raise exception 'not authorized'; end if;
  select * into e from public.events where id=target_event for update;
  if e.id is null or e.status in ('completed','cancelled','archived','suspended') then raise exception 'event cannot accept ticket changes'; end if;
  if char_length(trim(coalesce(tier_name,'')))<2 or tier_price<50 or tier_quantity<1 or tier_quantity>100000 then raise exception 'invalid ticket tier'; end if;
  if sales_end_value is not null and sales_start_value is not null and sales_end_value<=sales_start_value then raise exception 'invalid sales window'; end if;
  if sales_end_value is not null and sales_end_value>e.ends_at then raise exception 'ticket sales cannot end after the event'; end if;
  if target_tier is null then
    insert into public.ticket_types(event_id,name,description,price_cents,currency,quantity_total,quantity_sold,sales_start,sales_end,status,min_per_order,max_per_order,per_customer_limit,created_by,updated_at)
    values(e.id,left(trim(tier_name),80),nullif(left(trim(coalesce(tier_description,'')),500),''),tier_price,e.currency,tier_quantity,0,sales_start_value,sales_end_value,'active',1,greatest(1,least(tier_max_per_order,20)),greatest(1,least(tier_customer_limit,100)),auth.uid(),now()) returning id into result;
  else
    select * into existing from public.ticket_types where id=target_tier and event_id=e.id for update;
    if existing.id is null or tier_quantity<existing.quantity_sold then raise exception 'ticket tier unavailable'; end if;
    update public.ticket_types set name=left(trim(tier_name),80),description=nullif(left(trim(coalesce(tier_description,'')),500),''),price_cents=tier_price,quantity_total=tier_quantity,sales_start=sales_start_value,sales_end=sales_end_value,max_per_order=greatest(1,least(tier_max_per_order,20)),per_customer_limit=greatest(1,least(tier_customer_limit,100)),updated_at=now() where id=existing.id returning id into result;
  end if;
  update public.events set price_from_cents=(select min(price_cents) from public.ticket_types where event_id=e.id and status in ('active','sold_out') and price_cents>0),updated_at=now() where id=e.id;
  return result;
end$$;

create or replace function public.archive_ticket_tier_v1(target_event uuid,target_tier uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if not public.can_manage_event(target_event) then raise exception 'not authorized'; end if;
  if exists(select 1 from public.inventory_reservations where ticket_type_id=target_tier and status='held' and expires_at>now()) then raise exception 'ticket tier has active checkout holds'; end if;
  update public.ticket_types set status='archived',updated_at=now() where id=target_tier and event_id=target_event;
  return found;
end$$;

create or replace function public.create_promo_code_v1(target_event uuid,code_value text,percent_value integer,amount_value integer,max_uses integer)
returns uuid language plpgsql security definer set search_path=public as $$
declare e public.events%rowtype;created uuid;
begin
  if not public.can_manage_event(target_event) then raise exception 'not authorized'; end if;
  select * into e from public.events where id=target_event;
  if e.id is null or upper(trim(code_value))!~'^[A-Z0-9_-]{3,32}$' or num_nonnulls(percent_value,amount_value)<>1 then raise exception 'invalid promo code'; end if;
  insert into public.promo_codes(event_id,code,percent_off,amount_off_cents,currency,max_redemptions,created_by)
  values(e.id,upper(trim(code_value)),case when percent_value between 1 and 100 then percent_value end,case when amount_value>0 then amount_value end,e.currency,case when max_uses>0 then max_uses end,auth.uid()) returning id into created;
  return created;
end$$;

create or replace function public.set_paid_ticketing_v1(target_event uuid,enabled_value boolean)
returns boolean language plpgsql security definer set search_path=public as $$
declare account public.stripe_connected_accounts%rowtype;
begin
  if not public.can_manage_event(target_event) then raise exception 'not authorized'; end if;
  if enabled_value then
    select * into account from public.stripe_connected_accounts where profile_id=auth.uid();
    if account.profile_id is null or not account.charges_enabled or not account.payouts_enabled or account.fraud_hold then raise exception 'complete payout onboarding before enabling paid tickets'; end if;
    if not exists(select 1 from public.ticket_types where event_id=target_event and status='active' and price_cents>0) then raise exception 'add an active paid ticket tier first'; end if;
    update public.events set paid_ticketing_enabled=true,payout_profile_id=auth.uid(),price_from_cents=(select min(price_cents) from public.ticket_types where event_id=target_event and status='active' and price_cents>0),updated_at=now() where id=target_event;
  else update public.events set paid_ticketing_enabled=false,updated_at=now() where id=target_event; end if;
  return enabled_value;
end$$;

create or replace function public.event_ticketing_dashboard_v1(target_event uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare e public.events%rowtype;
begin
  if not public.can_manage_event(target_event) then raise exception 'not authorized'; end if;
  select * into e from public.events where id=target_event;
  return jsonb_build_object(
    'event',jsonb_build_object('id',e.id,'title',e.title,'slug',e.slug,'status',e.status,'currency',e.currency,'paid_ticketing_enabled',e.paid_ticketing_enabled,'payout_profile_id',e.payout_profile_id),
    'payout_account',(select to_jsonb(a)-'stripe_account_id' from public.stripe_connected_accounts a where a.profile_id=e.payout_profile_id),
    'fraud_hold',coalesce((select fraud_hold from public.stripe_connected_accounts where profile_id=e.payout_profile_id),false),
    'tiers',coalesce((select jsonb_agg(to_jsonb(t) order by t.price_cents,t.created_at) from public.ticket_types t where t.event_id=e.id),'[]'::jsonb),
    'promos',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc) from public.promo_codes p where p.event_id=e.id),'[]'::jsonb),
    'totals',jsonb_build_object('gross_cents',coalesce((select sum(amount_total_cents) from public.orders where event_id=e.id and status in ('paid','partially_refunded','refunded','disputed','fraud_hold')),0),'platform_fee_cents',coalesce((select sum(platform_fee_cents) from public.orders where event_id=e.id and status in ('paid','partially_refunded','refunded','disputed','fraud_hold')),0),'paid_orders',(select count(*) from public.orders where event_id=e.id and status in ('paid','partially_refunded','refunded','disputed','fraud_hold')),'tickets_sold',(select count(*) from public.tickets where event_id=e.id)),
    'refunds',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'order_id',r.order_id,'amount_cents',r.amount_cents,'currency',r.currency,'reason',r.reason,'status',r.status,'created_at',r.requested_at,'requester',jsonb_build_object('display_name',p.display_name,'username',p.username)) order by r.requested_at desc) from public.refund_requests r join public.orders o on o.id=r.order_id left join public.profiles p on p.id=r.requester_id where o.event_id=e.id and r.status in ('requested','approved','processing','pending','failed')),'[]'::jsonb),
    'open_refunds',(select count(*) from public.refund_requests r join public.orders o on o.id=r.order_id where o.event_id=e.id and r.status in ('requested','approved','processing','pending')),
    'open_disputes',(select count(*) from public.stripe_disputes d join public.orders o on o.id=d.order_id where o.event_id=e.id and d.status not in ('won','lost','warning_closed')),
    'ledger',jsonb_build_object('gross_cents',coalesce((select sum(le.amount_cents) from public.ledger_entries le join public.ledger_journals j on j.id=le.journal_id join public.orders o on o.id=j.order_id where o.event_id=e.id and le.account_code='stripe_cash' and j.journal_type='order_paid'),0),'seller_payable_cents',-coalesce((select sum(le.amount_cents) from public.ledger_entries le join public.ledger_journals j on j.id=le.journal_id join public.orders o on o.id=j.order_id where o.event_id=e.id and le.account_code='seller_payable' and j.journal_type='order_paid'),0),'platform_fee_cents',-coalesce((select sum(le.amount_cents) from public.ledger_entries le join public.ledger_journals j on j.id=le.journal_id join public.orders o on o.id=j.order_id where o.event_id=e.id and le.account_code='platform_fee_revenue' and j.journal_type='order_paid'),0),'refund_cents',-coalesce((select sum(le.amount_cents) from public.ledger_entries le join public.ledger_journals j on j.id=le.journal_id join public.orders o on o.id=j.order_id where o.event_id=e.id and le.account_code='stripe_cash' and j.journal_type='refund'),0))
  );
end$$;

create or replace function public.event_checkin_dashboard_v1(target_event uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not public.can_checkin_event(target_event) then raise exception 'not authorized'; end if;
  return jsonb_build_object('event',(select jsonb_build_object('id',id,'title',title,'starts_at',starts_at,'ends_at',ends_at) from public.events where id=target_event),'issued',(select count(*) from public.tickets where event_id=target_event and status in ('valid','transferred','checked_in')),'checked_in',(select count(*) from public.tickets where event_id=target_event and status='checked_in'),'recent',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'checkin_id',c.id,'ticket_id',c.ticket_id,'ticket_number',t.ticket_number,'status',c.result,'message',c.reason,'created_at',c.received_at) order by c.received_at desc) from (select * from public.ticket_checkin_events where event_id=target_event order by received_at desc limit 50)c left join public.tickets t on t.id=c.ticket_id),'[]'::jsonb));
end$$;

create or replace function public.request_event_publication(target uuid)
returns text language plpgsql security definer set search_path=public as $$
declare record_event public.events%rowtype;next_state public.event_status;account public.stripe_connected_accounts%rowtype;minimum_price integer;
begin
  if not public.can_manage_event(target) then raise exception 'Not authorized to publish this event'; end if;
  select * into record_event from public.events where id=target for update;
  if record_event.status not in ('draft','rejected','postponed') then raise exception 'This event cannot enter publication from its current status'; end if;
  if record_event.title is null or char_length(record_event.title)<3 or record_event.ends_at<=record_event.starts_at then raise exception 'Complete the required event details'; end if;
  if record_event.event_format in ('online','hybrid') and record_event.online_url is null then raise exception 'Add the online event link'; end if;
  if record_event.event_format in ('in_person','hybrid','private') and record_event.location_id is null and record_event.address_public is null and not record_event.has_private_address then raise exception 'Add the event location'; end if;
  if record_event.paid_ticketing_enabled or record_event.price_from_cents>0 then
    if record_event.payout_profile_id is null then raise exception 'Choose a payout owner for paid tickets'; end if;
    select * into account from public.stripe_connected_accounts where profile_id=record_event.payout_profile_id;
    if account.profile_id is null or not account.charges_enabled or not account.payouts_enabled or account.fraud_hold then raise exception 'Complete Stripe payout onboarding before publishing a paid event'; end if;
    select min(price_cents) into minimum_price from public.ticket_types where event_id=record_event.id and status='active' and price_cents>0 and (sales_end is null or sales_end>now());
    if minimum_price is null then raise exception 'Add an active paid ticket tier before publishing'; end if;
    update public.events set price_from_cents=minimum_price where id=record_event.id;
  end if;
  next_state:=case when record_event.publish_at is not null and record_event.publish_at>now() then 'scheduled'::public.event_status when record_event.event_format='private' or coalesce(record_event.min_age,0)>=18 or coalesce(record_event.capacity,0)>1000 then 'pending_review'::public.event_status else 'published'::public.event_status end;
  perform set_config('puddle.allow_status_transition','on',true);perform set_config('puddle.change_source','publication',true);
  update public.events set status=next_state,submitted_at=now(),published_at=case when next_state='published' then now() else published_at end,status_reason=null where id=target;
  return next_state::text;
end$$;

alter table public.stripe_connected_accounts enable row level security;
alter table public.payment_configuration enable row level security;
alter table public.ticket_types enable row level security;
alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.order_items enable row level security;
alter table public.refund_requests enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.stripe_disputes enable row level security;
alter table public.stripe_payouts enable row level security;
alter table public.ledger_journals enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.reconciliation_runs enable row level security;
alter table public.reconciliation_items enable row level security;
alter table public.ticket_transfers enable row level security;
alter table public.ticket_checkin_events enable row level security;

create policy "users read own Stripe readiness" on public.stripe_connected_accounts for select using(profile_id=auth.uid() or public.is_admin());
create policy "ticket types visible to owners or managers" on public.ticket_types for select using(public.can_manage_event(event_id) or exists(select 1 from public.tickets t where t.ticket_type_id=id and t.owner_id=auth.uid()) or public.is_admin());
create policy "buyers read own order items" on public.order_items for select using(exists(select 1 from public.orders o where o.id=order_id and (o.buyer_id=auth.uid() or public.can_manage_event(o.event_id) or public.is_admin())));
create policy "event managers read orders" on public.orders for select using(buyer_id=auth.uid() or public.can_manage_event(event_id) or public.is_admin());
create policy "ticket owners read tickets stage5" on public.tickets for select using(owner_id=auth.uid() or public.is_admin());
create policy "refund participants read requests" on public.refund_requests for select using(requester_id=auth.uid() or exists(select 1 from public.orders o where o.id=order_id and public.can_manage_event(o.event_id)) or public.is_admin());
create policy "transfer participants read transfers" on public.ticket_transfers for select using(sender_id=auth.uid() or recipient_id=auth.uid() or public.is_admin());
create policy "event staff read checkin audit" on public.ticket_checkin_events for select using(public.can_checkin_event(event_id) or public.is_admin());
create policy "payout owners read payouts" on public.stripe_payouts for select using(payout_profile_id=auth.uid() or public.is_admin());
create policy "admins read disputes" on public.stripe_disputes for select using(public.is_admin());
create policy "admins read ledger journals" on public.ledger_journals for select using(public.is_admin());
create policy "admins read ledger entries" on public.ledger_entries for select using(public.is_admin());
create policy "admins read reconciliation" on public.reconciliation_runs for select using(public.is_admin());
create policy "admins read reconciliation items" on public.reconciliation_items for select using(public.is_admin());

revoke all on function public.protect_immutable_financial_rows() from public,anon,authenticated;
revoke all on function public.order_checkout_payload_v1(uuid) from public,anon,authenticated;
revoke all on function public.fulfill_paid_order_v1(uuid,text,text,text,integer,text,text,text) from public,anon,authenticated;
revoke all on function public.expire_ticket_reservations_v1(integer) from public,anon,authenticated;
revoke all on function public.claim_stripe_webhook_events_v1(integer) from public,anon,authenticated;
revoke all on function public.complete_stripe_webhook_event_v1(bigint,boolean,jsonb,text) from public,anon,authenticated;
revoke all on function public.apply_stripe_refund_update_v1(text,text,integer,text,text,text) from public,anon,authenticated;
revoke all on function public.record_stripe_dispute_v1(text,text,integer,text,text,text,timestamptz,text) from public,anon,authenticated;
revoke all on function public.record_stripe_payout_v1(text,text,integer,text,text,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.fulfill_paid_order_v1(uuid,text,text,text,integer,text,text,text),public.expire_ticket_reservations_v1(integer),public.claim_stripe_webhook_events_v1(integer),public.complete_stripe_webhook_event_v1(bigint,boolean,jsonb,text),public.apply_stripe_refund_update_v1(text,text,integer,text,text,text),public.record_stripe_dispute_v1(text,text,integer,text,text,text,timestamptz,text),public.record_stripe_payout_v1(text,text,integer,text,text,timestamptz,text,text,text) to service_role;

revoke all on function public.public_ticket_tiers_v1(uuid) from public;
revoke all on function public.reserve_paid_order_v1(uuid,jsonb,text,uuid),public.attach_checkout_session_v1(uuid,text,timestamptz),public.cancel_order_reservation_v1(uuid,text),public.request_order_refund_v1(uuid,integer,text),public.decide_refund_request_v1(uuid,text),public.request_ticket_transfer_v1(uuid,text),public.accept_ticket_transfer_v1(uuid),public.cancel_ticket_transfer_v1(uuid),public.check_in_ticket_v1(uuid,uuid,integer,text,text,uuid,timestamptz,boolean,text),public.reverse_ticket_checkin_v1(uuid,uuid,text),public.lookup_event_tickets_v1(uuid,text),public.upsert_ticket_tier_v1(uuid,uuid,text,text,integer,integer,integer,integer,timestamptz,timestamptz),public.archive_ticket_tier_v1(uuid,uuid),public.create_promo_code_v1(uuid,text,integer,integer,integer),public.set_paid_ticketing_v1(uuid,boolean),public.event_ticketing_dashboard_v1(uuid),public.event_checkin_dashboard_v1(uuid) from public,anon;

grant execute on function public.public_ticket_tiers_v1(uuid) to anon,authenticated;
grant execute on function public.reserve_paid_order_v1(uuid,jsonb,text,uuid),public.attach_checkout_session_v1(uuid,text,timestamptz),public.cancel_order_reservation_v1(uuid,text),public.request_order_refund_v1(uuid,integer,text),public.decide_refund_request_v1(uuid,text),public.request_ticket_transfer_v1(uuid,text),public.accept_ticket_transfer_v1(uuid),public.cancel_ticket_transfer_v1(uuid),public.check_in_ticket_v1(uuid,uuid,integer,text,text,uuid,timestamptz,boolean,text),public.reverse_ticket_checkin_v1(uuid,uuid,text),public.lookup_event_tickets_v1(uuid,text),public.upsert_ticket_tier_v1(uuid,uuid,text,text,integer,integer,integer,integer,timestamptz,timestamptz),public.archive_ticket_tier_v1(uuid,uuid),public.create_promo_code_v1(uuid,text,integer,integer,integer),public.set_paid_ticketing_v1(uuid,boolean),public.event_ticketing_dashboard_v1(uuid),public.event_checkin_dashboard_v1(uuid) to authenticated;

grant select on public.stripe_connected_accounts,public.ticket_types,public.orders,public.order_items,public.tickets,public.refund_requests,public.ticket_transfers,public.ticket_checkin_events,public.stripe_payouts to authenticated;
grant usage,select on sequence public.stripe_webhook_events_id_seq,public.promo_redemptions_id_seq,public.ledger_entries_id_seq,public.reconciliation_items_id_seq to service_role;
