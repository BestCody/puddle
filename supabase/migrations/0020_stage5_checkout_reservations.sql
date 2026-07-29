-- Stage 5B: public inventory, transactional reservations, checkout attachment, and replay-safe webhook queue.
-- Apply after 0019_stage5_financial_foundation.sql.

create or replace function public.public_ticket_tiers_v1(target_event uuid)
returns table(id uuid,name text,description text,price_cents integer,currency char(3),min_per_order integer,max_per_order integer,per_customer_limit integer,sales_start timestamptz,sales_end timestamptz,available_quantity integer)
language sql stable security definer set search_path=public as $$
  select t.id,t.name,t.description,t.price_cents,t.currency,t.min_per_order,t.max_per_order,t.per_customer_limit,t.sales_start,t.sales_end,
    greatest(0,t.quantity_total-t.quantity_sold-coalesce((select sum(r.quantity)::integer from public.inventory_reservations r where r.ticket_type_id=t.id and r.status='held' and r.expires_at>now()),0))
  from public.ticket_types t join public.events e on e.id=t.event_id
  where t.event_id=target_event and e.status='published' and e.visibility='public' and e.paid_ticketing_enabled
    and t.status='active' and t.price_cents>0 and (t.sales_start is null or t.sales_start<=now()) and (t.sales_end is null or t.sales_end>now())
  order by t.price_cents,t.created_at
$$;

create or replace function public.order_checkout_payload_v1(target_order uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'order',jsonb_build_object('id',o.id,'event_id',o.event_id,'buyer_id',o.buyer_id,'currency',o.currency,'subtotal_cents',o.subtotal_cents,'discount_cents',o.discount_cents,'tax_cents',o.tax_cents,'platform_fee_cents',o.platform_fee_cents,'amount_total_cents',o.amount_total_cents,'status',o.status),
    'line_items',coalesce((select jsonb_agg(jsonb_build_object('ticket_type_id',i.ticket_type_id,'name',i.quantity||' × '||i.name,'description',i.description,'quantity',1,'unit_amount_cents',i.total_cents) order by i.created_at) from public.order_items i where i.order_id=o.id),'[]'::jsonb),
    'destination_account',a.stripe_account_id,
    'event_slug',e.slug
  )
  from public.orders o join public.events e on e.id=o.event_id join public.stripe_connected_accounts a on a.profile_id=o.payout_profile_id
  where o.id=target_order
$$;

create or replace function public.reserve_paid_order_v1(target_event uuid,requested_items jsonb,promo_code_value text default null,request_key uuid default gen_random_uuid())
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); listing public.events%rowtype; payout public.stripe_connected_accounts%rowtype; config public.payment_configuration%rowtype; existing uuid; created_order uuid; item record; tier public.ticket_types%rowtype; requested_count integer; held integer; prior integer; available integer; subtotal integer:=0; discount integer:=0; total integer; fee integer; promo public.promo_codes%rowtype; promo_pending integer; promo_prior integer; customer_held integer; expires timestamptz; allocated integer:=0; last_item uuid;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if request_key is null then raise exception 'idempotency key required'; end if;
  if jsonb_typeof(requested_items)<>'array' or jsonb_array_length(requested_items)<1 or jsonb_array_length(requested_items)>10 then raise exception 'invalid ticket selection'; end if;
  if (select count(*) from jsonb_to_recordset(requested_items) as x(ticket_type_id uuid,quantity integer))<>(select count(distinct ticket_type_id) from jsonb_to_recordset(requested_items) as x(ticket_type_id uuid,quantity integer)) then raise exception 'duplicate ticket tier'; end if;
  select id into existing from public.orders where buyer_id=actor and idempotency_key=request_key;
  if existing is not null then return public.order_checkout_payload_v1(existing); end if;
  select * into listing from public.events where id=target_event and status='published' and visibility='public' for share;
  if listing.id is null or not listing.paid_ticketing_enabled or listing.ends_at<=now() then raise exception 'paid event unavailable'; end if;
  if listing.payout_profile_id is null then raise exception 'event payout account is missing'; end if;
  select * into payout from public.stripe_connected_accounts where profile_id=listing.payout_profile_id for share;
  if payout.profile_id is null or not payout.charges_enabled or not payout.payouts_enabled or payout.fraud_hold then raise exception 'event payouts are not ready'; end if;
  select * into config from public.payment_configuration where singleton=true;
  expires:=now()+make_interval(mins=>coalesce(config.reservation_minutes,30));
  insert into public.orders(buyer_id,event_id,host_profile_id,payout_profile_id,status,amount_total_cents,currency,idempotency_key,expires_at,metadata)
  values(actor,listing.id,listing.host_profile_id,listing.payout_profile_id,'pending',0,listing.currency,request_key,expires,jsonb_build_object('source','puddle_checkout')) returning id into created_order;
  for item in select * from jsonb_to_recordset(requested_items) as x(ticket_type_id uuid,quantity integer) order by ticket_type_id loop
    if item.quantity is null or item.quantity<1 or item.quantity>20 then raise exception 'invalid ticket quantity'; end if;
    select * into tier from public.ticket_types where id=item.ticket_type_id for update;
    if tier.id is null or tier.event_id<>listing.id or tier.status<>'active' or tier.price_cents<=0 then raise exception 'ticket tier unavailable'; end if;
    if tier.sales_start is not null and tier.sales_start>now() then raise exception 'ticket sales have not started'; end if;
    if tier.sales_end is not null and tier.sales_end<=now() then raise exception 'ticket sales ended'; end if;
    if item.quantity<tier.min_per_order or item.quantity>tier.max_per_order then raise exception 'ticket quantity outside tier limits'; end if;
    select coalesce(sum(i.quantity),0)::integer into prior from public.order_items i join public.orders o on o.id=i.order_id where o.buyer_id=actor and i.ticket_type_id=tier.id and o.status in ('paid','partially_refunded','disputed','fraud_hold');
    select coalesce(sum(r.quantity),0)::integer into customer_held from public.inventory_reservations r where r.ticket_type_id=tier.id and r.profile_id=actor and r.status='held' and r.expires_at>now();
    select coalesce(sum(r.quantity),0)::integer into held from public.inventory_reservations r where r.ticket_type_id=tier.id and r.status='held' and r.expires_at>now();
    if prior+customer_held+item.quantity>tier.per_customer_limit then raise exception 'per-customer ticket limit reached'; end if;
    available:=tier.quantity_total-tier.quantity_sold-held;
    if available<item.quantity then raise exception 'not enough ticket inventory available'; end if;
    insert into public.order_items(order_id,ticket_type_id,name,description,quantity,unit_amount_cents,subtotal_cents,total_cents,currency)
    values(created_order,tier.id,tier.name,tier.description,item.quantity,tier.price_cents,tier.price_cents*item.quantity,tier.price_cents*item.quantity,tier.currency);
    insert into public.inventory_reservations(ticket_type_id,profile_id,quantity,expires_at,order_id,status,idempotency_key)
    values(tier.id,actor,item.quantity,expires,created_order,'held',request_key);
    subtotal:=subtotal+tier.price_cents*item.quantity;
  end loop;
  if promo_code_value is not null and trim(promo_code_value)<>'' then
    select * into promo from public.promo_codes where event_id=listing.id and code=upper(trim(promo_code_value)) for update;
    if promo.id is null or not promo.active or (promo.starts_at is not null and promo.starts_at>now()) or (promo.ends_at is not null and promo.ends_at<=now()) then raise exception 'promo code is not valid'; end if;
    if promo.currency<>listing.currency then raise exception 'promo code currency mismatch'; end if;
    select count(*)::integer into promo_prior from public.promo_redemptions where promo_code_id=promo.id and profile_id=actor;
    if promo_prior>=promo.per_customer_limit then raise exception 'promo code customer limit reached'; end if;
    select count(*)::integer into promo_pending from public.orders where promo_code_id=promo.id and status in ('pending','checkout_created','payment_processing') and expires_at>now();
    if promo.max_redemptions is not null and promo.redemption_count+promo_pending>=promo.max_redemptions then raise exception 'promo code redemption limit reached'; end if;
    discount:=case when promo.percent_off is not null then floor(subtotal*promo.percent_off/100.0)::integer else least(subtotal,promo.amount_off_cents) end;
    update public.orders set promo_code_id=promo.id where id=created_order;
  end if;
  total:=greatest(0,subtotal-discount);
  if total<50 then raise exception 'paid checkout total is below the minimum'; end if;
  fee:=least(total,round(total*coalesce(config.platform_fee_bps,500)/10000.0)::integer+coalesce(config.fixed_fee_cents,0));
  select id into last_item from public.order_items where order_id=created_order order by created_at desc,id desc limit 1;
  with shares as (
    select id,case when discount=0 then 0 else floor(discount*subtotal_cents/nullif(subtotal,0)::numeric)::integer end share from public.order_items where order_id=created_order
  ) update public.order_items i set discount_cents=s.share,total_cents=i.subtotal_cents-s.share from shares s where i.id=s.id;
  select coalesce(sum(discount_cents),0)::integer into allocated from public.order_items where order_id=created_order;
  if allocated<discount then update public.order_items set discount_cents=discount_cents+(discount-allocated),total_cents=total_cents-(discount-allocated) where id=last_item; end if;
  update public.orders set subtotal_cents=subtotal,discount_cents=discount,tax_cents=0,platform_fee_cents=fee,amount_total_cents=total,updated_at=now() where id=created_order;
  return public.order_checkout_payload_v1(created_order);
end$$;

create or replace function public.attach_checkout_session_v1(target_order uuid,stripe_session text,checkout_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  update public.orders set stripe_checkout_session_id=stripe_session,status='checkout_created',expires_at=checkout_expires_at,updated_at=now() where id=target_order and buyer_id=auth.uid() and status='pending';
  if not found then raise exception 'order unavailable'; end if;
  update public.inventory_reservations set checkout_session_id=stripe_session,expires_at=checkout_expires_at,updated_at=now() where order_id=target_order and status='held';
  return jsonb_build_object('order_id',target_order,'status','checkout_created');
end$$;

create or replace function public.cancel_order_reservation_v1(target_order uuid,cancellation_reason text default 'cancelled')
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); current_status text;
begin
  select status into current_status from public.orders where id=target_order for update;
  if current_status is null then return jsonb_build_object('status','missing'); end if;
  if actor is distinct from (select buyer_id from public.orders where id=target_order) and auth.role()<>'service_role' then raise exception 'not authorized'; end if;
  if current_status in ('paid','partially_refunded','refunded','disputed','fraud_hold','payment_review') then return jsonb_build_object('status',current_status); end if;
  update public.orders set status=case when cancellation_reason ilike '%expired%' then 'expired' else 'cancelled' end,cancelled_at=now(),metadata=metadata||jsonb_build_object('cancellation_reason',left(cancellation_reason,120)),updated_at=now() where id=target_order;
  update public.inventory_reservations set status=case when expires_at<=now() then 'expired' else 'released' end,updated_at=now() where order_id=target_order and status='held';
  return jsonb_build_object('status','cancelled');
end$$;

create or replace function public.expire_ticket_reservations_v1(batch_size integer default 500)
returns integer language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
  if auth.role()<>'service_role' then raise exception 'service role required'; end if;
  with due as (select id from public.inventory_reservations where status='held' and expires_at<=now() order by expires_at limit greatest(1,least(batch_size,5000)) for update skip locked), released as (update public.inventory_reservations r set status='expired',updated_at=now() from due where r.id=due.id returning r.order_id)
  update public.orders o set status='expired',cancelled_at=now(),updated_at=now() where o.id in (select distinct order_id from released where order_id is not null) and o.status in ('pending','checkout_created','payment_processing');
  get diagnostics changed=row_count; return changed;
end$$;

create or replace function public.claim_stripe_webhook_events_v1(batch_size integer default 25)
returns setof public.stripe_webhook_events language plpgsql security definer set search_path=public as $$
begin
  if auth.role()<>'service_role' then raise exception 'service role required'; end if;
  return query with claimed as (select id from public.stripe_webhook_events where status in ('pending','failed') and next_attempt_at<=now() order by id limit greatest(1,least(batch_size,100)) for update skip locked)
    update public.stripe_webhook_events e set status='processing',attempts=attempts+1,processing_started_at=now(),last_error=null from claimed where e.id=claimed.id returning e.*;
end$$;

create or replace function public.complete_stripe_webhook_event_v1(target_event bigint,succeeded boolean,result_data jsonb default '{}'::jsonb,error_message text default null)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if auth.role()<>'service_role' then raise exception 'service role required'; end if;
  update public.stripe_webhook_events set status=case when succeeded then 'processed' else 'failed' end,result=coalesce(result_data,'{}'),last_error=case when succeeded then null else left(error_message,1000) end,processed_at=case when succeeded then now() else processed_at end,next_attempt_at=case when succeeded then now() else now()+least(interval '6 hours',make_interval(mins=>power(2,least(attempts,8))::integer)) end where id=target_event;
  return found;
end$$;
