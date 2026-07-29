-- Stage 5C: webhook-only fulfillment, signed ticket lifecycle, transfers, refunds, disputes, payouts, and check-in audit.
-- Apply after 0020_stage5_checkout_reservations.sql.

alter table public.tickets add column if not exists event_id uuid references public.events(id) on delete restrict;
alter table public.tickets add column if not exists order_item_id uuid references public.order_items(id) on delete restrict;
alter table public.tickets add column if not exists ticket_number text;
alter table public.tickets add column if not exists token_version integer not null default 1;
alter table public.tickets add column if not exists signed_token text;
alter table public.tickets add column if not exists signed_at timestamptz;
alter table public.tickets add column if not exists checked_in_by uuid references public.profiles(id) on delete set null;
alter table public.tickets add column if not exists transferred_at timestamptz;
alter table public.tickets add column if not exists void_reason text;
alter table public.tickets add column if not exists updated_at timestamptz not null default now();
update public.tickets t set event_id=tt.event_id from public.ticket_types tt where tt.id=t.ticket_type_id and t.event_id is null;
update public.tickets set ticket_number='PDL-'||upper(substr(replace(id::text,'-',''),1,20)) where ticket_number is null;
alter table public.tickets alter column event_id set not null;
alter table public.tickets alter column ticket_number set not null;
create unique index if not exists tickets_number_unique on public.tickets(ticket_number);
create index if not exists tickets_event_status_idx on public.tickets(event_id,status,created_at);
create index if not exists tickets_owner_event_idx on public.tickets(owner_id,event_id,status);

create table if not exists public.ticket_transfers (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete restrict,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  recipient_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled','expired')),
  expires_at timestamptz not null default now()+interval '72 hours',
  accepted_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(sender_id<>recipient_id)
);
create unique index if not exists ticket_transfers_one_pending on public.ticket_transfers(ticket_id) where status='pending';
create index if not exists ticket_transfers_recipient_idx on public.ticket_transfers(recipient_id,status,created_at desc);

create table if not exists public.ticket_checkin_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  ticket_id uuid references public.tickets(id) on delete restrict,
  staff_id uuid not null references public.profiles(id) on delete restrict,
  device_id text not null,
  scan_id uuid not null,
  token_version integer,
  token_hash text,
  action text not null check(action in ('scan','manual','reverse','offline_sync')),
  result text not null check(result in ('checked_in','duplicate','rejected','reversed')),
  reason text,
  scanned_at timestamptz not null,
  received_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique(staff_id,device_id,scan_id)
);
create index if not exists ticket_checkin_event_idx on public.ticket_checkin_events(event_id,received_at desc);
create index if not exists ticket_checkin_ticket_idx on public.ticket_checkin_events(ticket_id,received_at desc);

drop trigger if exists ticket_checkin_events_immutable on public.ticket_checkin_events;
create trigger ticket_checkin_events_immutable before update or delete on public.ticket_checkin_events for each row execute function public.protect_immutable_financial_rows();

create or replace function public.fulfill_paid_order_v1(target_order uuid,stripe_session text,stripe_payment_intent text,stripe_charge text,paid_amount integer,paid_currency text,receipt_url_value text,stripe_event text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.orders%rowtype; item record; tier public.ticket_types%rowtype; journal uuid; seller_amount integer; promo public.promo_codes%rowtype;other_held integer;
begin
  if auth.role()<>'service_role' then raise exception 'service role required'; end if;
  select * into o from public.orders where id=target_order for update;
  if o.id is null then raise exception 'order not found'; end if;
  if o.status in ('paid','partially_refunded','refunded','disputed','fraud_hold') then return jsonb_build_object('status','already_paid','order_id',o.id); end if;
  if o.status not in ('pending','checkout_created','payment_processing','expired') then raise exception 'order cannot be fulfilled'; end if;
  if paid_amount<>o.amount_total_cents or upper(paid_currency)<>upper(o.currency) then
    update public.orders set status='payment_review',fraud_hold_reason='Stripe amount or currency mismatch',stripe_payment_intent_id=coalesce(stripe_payment_intent_id,stripe_payment_intent),stripe_charge_id=coalesce(stripe_charge_id,stripe_charge),updated_at=now() where id=o.id;
    return jsonb_build_object('status','payment_review','order_id',o.id);
  end if;
  if o.stripe_checkout_session_id is not null and stripe_session is not null and o.stripe_checkout_session_id<>stripe_session then
    update public.orders set status='payment_review',fraud_hold_reason='Stripe Checkout Session mismatch',updated_at=now() where id=o.id;
    return jsonb_build_object('status','payment_review','order_id',o.id);
  end if;
  for item in select * from public.order_items where order_id=o.id order by ticket_type_id loop
    select * into tier from public.ticket_types where id=item.ticket_type_id for update;
    select coalesce(sum(r.quantity),0)::integer into other_held from public.inventory_reservations r where r.ticket_type_id=item.ticket_type_id and r.order_id<>o.id and r.status='held' and r.expires_at>now();
    if tier.id is null or tier.event_id<>o.event_id or tier.quantity_sold+other_held+item.quantity>tier.quantity_total then
      update public.orders set status='payment_review',fraud_hold_reason='Paid order no longer has fulfillable inventory',stripe_payment_intent_id=stripe_payment_intent,stripe_charge_id=stripe_charge,updated_at=now() where id=o.id;
      update public.stripe_connected_accounts set fraud_hold=true,fraud_hold_reason='Paid order inventory exception',updated_at=now() where profile_id=o.payout_profile_id;
      return jsonb_build_object('status','payment_review','order_id',o.id);
    end if;
  end loop;
  update public.orders set status='paid',stripe_checkout_session_id=coalesce(stripe_session,stripe_checkout_session_id),stripe_payment_intent_id=stripe_payment_intent,stripe_charge_id=stripe_charge,receipt_url=receipt_url_value,paid_at=coalesce(paid_at,now()),expires_at=null,fraud_hold_reason=null,updated_at=now() where id=o.id;
  update public.inventory_reservations set status='consumed',consumed_at=coalesce(consumed_at,now()),updated_at=now() where order_id=o.id and status in ('held','expired');
  for item in select * from public.order_items where order_id=o.id order by ticket_type_id loop
    update public.ticket_types set quantity_sold=quantity_sold+item.quantity,status=case when quantity_sold+item.quantity>=quantity_total then 'sold_out' else status end,updated_at=now() where id=item.ticket_type_id;
    insert into public.tickets(order_id,ticket_type_id,event_id,order_item_id,owner_id,signed_code_hash,status,ticket_number,token_version)
    select o.id,item.ticket_type_id,o.event_id,item.id,o.buyer_id,encode(digest(gen_random_uuid()::text,'sha256'),'hex'),'valid','PDL-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,20)),1 from generate_series(1,item.quantity);
  end loop;
  if o.promo_code_id is not null and not exists(select 1 from public.promo_redemptions where order_id=o.id) then
    select * into promo from public.promo_codes where id=o.promo_code_id for update;
    insert into public.promo_redemptions(promo_code_id,profile_id,order_id,discount_cents) values(o.promo_code_id,o.buyer_id,o.id,o.discount_cents);
    update public.promo_codes set redemption_count=redemption_count+1,updated_at=now() where id=o.promo_code_id;
  end if;
  insert into public.ledger_journals(journal_type,order_id,stripe_event_id,currency,description) values('order_paid',o.id,stripe_event,o.currency,'Stripe-confirmed ticket order') returning id into journal;
  seller_amount:=o.amount_total_cents-o.platform_fee_cents-o.tax_cents;
  insert into public.ledger_entries(journal_id,account_code,amount_cents) values(journal,'stripe_cash',o.amount_total_cents);
  if seller_amount>0 then insert into public.ledger_entries(journal_id,account_code,profile_id,amount_cents) values(journal,'seller_payable',o.payout_profile_id,-seller_amount); end if;
  if o.platform_fee_cents>0 then insert into public.ledger_entries(journal_id,account_code,amount_cents) values(journal,'platform_fee_revenue',-o.platform_fee_cents); end if;
  if o.tax_cents>0 then insert into public.ledger_entries(journal_id,account_code,amount_cents) values(journal,'tax_payable',-o.tax_cents); end if;
  return jsonb_build_object('status','paid','order_id',o.id,'tickets_issued',(select count(*) from public.tickets where order_id=o.id));
end$$;

create or replace function public.request_order_refund_v1(target_order uuid,requested_amount integer,request_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();o public.orders%rowtype;e public.events%rowtype;config public.payment_configuration%rowtype;available integer;created uuid;
begin
  if actor is null then raise exception 'authentication required'; end if;
  select * into o from public.orders where id=target_order and buyer_id=actor for update;
  if o.id is null or o.status not in ('paid','partially_refunded') then raise exception 'order is not refundable'; end if;
  select * into e from public.events where id=o.event_id;select * into config from public.payment_configuration where singleton=true;
  if e.starts_at<=now()+make_interval(hours=>coalesce(config.default_refund_window_hours,0)) then raise exception 'the refund request window has closed'; end if;
  available:=o.amount_total_cents-o.refund_total_cents-coalesce((select sum(amount_cents) from public.refund_requests where order_id=o.id and status in ('requested','approved','processing','pending')),0);
  if requested_amount<=0 or requested_amount>available then raise exception 'refund amount exceeds refundable balance'; end if;
  if char_length(trim(coalesce(request_reason,'')))<3 then raise exception 'refund reason required'; end if;
  insert into public.refund_requests(order_id,requester_id,amount_cents,currency,reason) values(o.id,actor,requested_amount,o.currency,left(trim(request_reason),1000)) returning id into created;
  return jsonb_build_object('id',created,'status','requested','amount_cents',requested_amount);
end$$;

create or replace function public.decide_refund_request_v1(target_refund uuid,decision_value text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.refund_requests%rowtype;o public.orders%rowtype;
begin
  select * into r from public.refund_requests where id=target_refund for update;
  if r.id is null or r.status<>'requested' then raise exception 'refund request unavailable'; end if;
  select * into o from public.orders where id=r.order_id for update;
  if not public.can_manage_event(o.event_id) and not public.is_admin() then raise exception 'not authorized'; end if;
  if decision_value='decline' then update public.refund_requests set status='declined',decided_by=auth.uid(),decided_at=now(),updated_at=now() where id=r.id;return jsonb_build_object('status','declined'); end if;
  if decision_value<>'approve' then raise exception 'invalid refund decision'; end if;
  if o.stripe_charge_id is null or r.amount_cents>o.amount_total_cents-o.refund_total_cents then raise exception 'refund cannot be processed'; end if;
  update public.refund_requests set status='approved',decided_by=auth.uid(),decided_at=now(),updated_at=now() where id=r.id;
  return jsonb_build_object('status','approved','refund_id',r.id,'amount_cents',r.amount_cents,'stripe_charge_id',o.stripe_charge_id);
end$$;

create or replace function public.apply_stripe_refund_update_v1(stripe_refund text,stripe_charge text,refund_amount integer,refund_status text,failure_reason_value text,stripe_event text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.refund_requests%rowtype;o public.orders%rowtype;journal uuid;fee_refund integer;seller_refund integer;prior_status text;
begin
  if auth.role()<>'service_role' then raise exception 'service role required'; end if;
  select * into r from public.refund_requests where stripe_refund_id=stripe_refund for update;
  if r.id is null then select rr.* into r from public.refund_requests rr join public.orders oo on oo.id=rr.order_id where oo.stripe_charge_id=stripe_charge and rr.amount_cents=refund_amount and rr.status in ('approved','processing','pending') order by rr.decided_at desc limit 1 for update of rr; end if;
  if r.id is null then return jsonb_build_object('status','unmatched_refund'); end if;
  select * into o from public.orders where id=r.order_id for update;
  prior_status:=r.status;
  update public.refund_requests set stripe_refund_id=stripe_refund,status=case when refund_status='succeeded' then 'succeeded' when refund_status in ('failed','canceled') then 'failed' else 'pending' end,failure_reason=failure_reason_value,processed_at=case when refund_status in ('succeeded','failed','canceled') then now() else processed_at end,updated_at=now() where id=r.id;
  if refund_status='succeeded' and prior_status<>'succeeded' then
    update public.orders set refund_total_cents=least(amount_total_cents,refund_total_cents+r.amount_cents),status=case when refund_total_cents+r.amount_cents>=amount_total_cents then 'refunded' else 'partially_refunded' end,updated_at=now() where id=o.id returning * into o;
    if o.status='refunded' then update public.tickets set status='refunded',token_version=token_version+1,signed_token=null,signed_at=null,void_reason='Order refunded',updated_at=now() where order_id=o.id and status<>'checked_in'; end if;
    fee_refund:=case when o.amount_total_cents=0 then 0 else round(r.amount_cents*o.platform_fee_cents/o.amount_total_cents::numeric)::integer end;
    seller_refund:=r.amount_cents-fee_refund;
    insert into public.ledger_journals(journal_type,order_id,refund_request_id,stripe_event_id,currency,description) values('refund',o.id,r.id,stripe_event,o.currency,'Stripe refund') returning id into journal;
    insert into public.ledger_entries(journal_id,account_code,amount_cents) values(journal,'stripe_cash',-r.amount_cents);
    if seller_refund>0 then insert into public.ledger_entries(journal_id,account_code,profile_id,amount_cents) values(journal,'seller_payable',o.payout_profile_id,seller_refund); end if;
    if fee_refund>0 then insert into public.ledger_entries(journal_id,account_code,amount_cents) values(journal,'platform_fee_revenue',fee_refund); end if;
  end if;
  return jsonb_build_object('status',refund_status,'refund_id',r.id,'order_id',o.id);
end$$;

create or replace function public.record_stripe_dispute_v1(stripe_dispute text,stripe_charge text,dispute_amount integer,dispute_currency text,dispute_status text,dispute_reason text,evidence_due timestamptz,stripe_event text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.orders%rowtype;d uuid;journal uuid;existing_status text;has_debit boolean;has_reversal boolean;
begin
  if auth.role()<>'service_role' then raise exception 'service role required'; end if;
  select * into o from public.orders where stripe_charge_id=stripe_charge for update;
  select id,status into d,existing_status from public.stripe_disputes where stripe_dispute_id=stripe_dispute for update;
  if d is null then
    insert into public.stripe_disputes(order_id,stripe_dispute_id,stripe_charge_id,amount_cents,currency,status,reason,evidence_due_at,last_stripe_event_id)
    values(o.id,stripe_dispute,stripe_charge,greatest(dispute_amount,0),upper(dispute_currency),dispute_status,dispute_reason,evidence_due,stripe_event) returning id into d;
  else
    update public.stripe_disputes set amount_cents=greatest(dispute_amount,0),status=dispute_status,reason=dispute_reason,evidence_due_at=evidence_due,closed_at=case when dispute_status in ('won','lost','warning_closed') then now() else null end,updated_at=now(),last_stripe_event_id=stripe_event where id=d;
  end if;
  if o.id is not null and dispute_status not in ('won','warning_closed') then
    update public.orders set status='disputed',dispute_total_cents=greatest(dispute_total_cents,greatest(dispute_amount,0)),fraud_hold_reason='Open Stripe dispute',updated_at=now() where id=o.id;
    update public.stripe_connected_accounts set fraud_hold=true,fraud_hold_reason='Open Stripe dispute',updated_at=now() where profile_id=o.payout_profile_id;
  elsif o.id is not null and dispute_status in ('won','warning_closed') then
    update public.orders set status=case when refund_total_cents>=amount_total_cents then 'refunded' when refund_total_cents>0 then 'partially_refunded' else 'paid' end,fraud_hold_reason=null,updated_at=now() where id=o.id;
    if not exists(select 1 from public.stripe_disputes x join public.orders xo on xo.id=x.order_id where xo.payout_profile_id=o.payout_profile_id and x.id<>d and x.status not in ('won','lost','warning_closed')) then
      update public.stripe_connected_accounts set fraud_hold=false,fraud_hold_reason=null,updated_at=now() where profile_id=o.payout_profile_id and fraud_hold_reason='Open Stripe dispute';
    end if;
  end if;
  select exists(select 1 from public.ledger_journals where dispute_id=d and journal_type='dispute') into has_debit;
  select exists(select 1 from public.ledger_journals where dispute_id=d and journal_type='dispute_reversal') into has_reversal;
  if o.id is not null and dispute_amount>0 and dispute_status in ('needs_response','under_review','lost') and not has_debit then
    insert into public.ledger_journals(journal_type,order_id,dispute_id,stripe_event_id,currency,description) values('dispute',o.id,d,stripe_event,o.currency,'Stripe dispute opened') returning id into journal;
    insert into public.ledger_entries(journal_id,account_code,amount_cents) values(journal,'stripe_cash',-dispute_amount),(journal,'disputes',dispute_amount);
  elsif o.id is not null and dispute_amount>0 and dispute_status='won' and has_debit and not has_reversal then
    insert into public.ledger_journals(journal_type,order_id,dispute_id,stripe_event_id,currency,description) values('dispute_reversal',o.id,d,stripe_event,o.currency,'Stripe dispute won') returning id into journal;
    insert into public.ledger_entries(journal_id,account_code,amount_cents) values(journal,'stripe_cash',dispute_amount),(journal,'disputes',-dispute_amount);
  end if;
  return jsonb_build_object('status',dispute_status,'dispute_id',d,'order_id',o.id);
end$$;

create or replace function public.record_stripe_payout_v1(stripe_payout text,stripe_account text,payout_amount integer,payout_currency text,payout_status text,arrival_at_value timestamptz,failure_code_value text,failure_message_value text,stripe_event text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare profile uuid;p uuid;prior text;journal uuid;
begin
  if auth.role()<>'service_role' then raise exception 'service role required'; end if;
  select profile_id into profile from public.stripe_connected_accounts where stripe_account_id=stripe_account;
  select id,status into p,prior from public.stripe_payouts where stripe_payout_id=stripe_payout for update;
  if p is null then insert into public.stripe_payouts(payout_profile_id,stripe_account_id,stripe_payout_id,amount_cents,currency,status,arrival_at,failure_code,failure_message,last_stripe_event_id) values(profile,stripe_account,stripe_payout,payout_amount,upper(payout_currency),case when payout_status='canceled' then 'cancelled' when payout_status in ('pending','in_transit','paid','failed','cancelled') then payout_status else 'pending' end,arrival_at_value,failure_code_value,failure_message_value,stripe_event) returning id into p;
  else update public.stripe_payouts set status=case when payout_status='canceled' then 'cancelled' when payout_status in ('pending','in_transit','paid','failed','cancelled') then payout_status else status end,arrival_at=arrival_at_value,failure_code=failure_code_value,failure_message=failure_message_value,updated_at=now(),last_stripe_event_id=stripe_event where id=p; end if;
  if payout_status='paid' and payout_amount>0 and prior is distinct from 'paid' and profile is not null then insert into public.ledger_journals(journal_type,payout_id,stripe_event_id,currency,description) values('payout',p,stripe_event,upper(payout_currency),'Connected account payout') returning id into journal;insert into public.ledger_entries(journal_id,account_code,profile_id,amount_cents) values(journal,'seller_payable',profile,payout_amount),(journal,'external_payout',profile,-payout_amount); end if;
  if payout_status='failed' then update public.stripe_connected_accounts set payout_status='failed',disabled_reason=coalesce(failure_message_value,failure_code_value),updated_at=now() where profile_id=profile; end if;
  return jsonb_build_object('status',payout_status,'payout_id',p,'profile_id',profile);
end$$;

create or replace function public.request_ticket_transfer_v1(target_ticket uuid,recipient_username text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();t public.tickets%rowtype;recipient uuid;created uuid;
begin
  select * into t from public.tickets where id=target_ticket and owner_id=actor for update;
  if t.id is null or t.status<>'valid' or t.checked_in_at is not null then raise exception 'ticket cannot be transferred'; end if;
  select id into recipient from public.profiles where lower(username)=lower(trim(leading '@' from recipient_username)) and suspended_at is null;
  if recipient is null or recipient=actor then raise exception 'recipient unavailable'; end if;
  if exists(select 1 from public.blocks where (blocker_id=actor and blocked_id=recipient) or (blocker_id=recipient and blocked_id=actor)) then raise exception 'recipient unavailable'; end if;
  insert into public.ticket_transfers(ticket_id,sender_id,recipient_id) values(t.id,actor,recipient) returning id into created;
  return jsonb_build_object('transfer_id',created,'status','pending');
end$$;

create or replace function public.accept_ticket_transfer_v1(target_transfer uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare tr public.ticket_transfers%rowtype;t public.tickets%rowtype;
begin
  select * into tr from public.ticket_transfers where id=target_transfer for update;
  if tr.id is null or tr.recipient_id<>auth.uid() or tr.status<>'pending' or tr.expires_at<=now() then raise exception 'transfer unavailable'; end if;
  select * into t from public.tickets where id=tr.ticket_id for update;
  if t.owner_id<>tr.sender_id or t.status<>'valid' or t.checked_in_at is not null then raise exception 'ticket transfer is no longer valid'; end if;
  update public.tickets set owner_id=tr.recipient_id,status='transferred',token_version=token_version+1,signed_token=null,signed_at=null,transferred_at=now(),updated_at=now() where id=t.id;
  update public.ticket_transfers set status='accepted',accepted_at=now(),updated_at=now() where id=tr.id;
  return jsonb_build_object('transfer_id',tr.id,'ticket_id',t.id,'status','accepted');
end$$;

create or replace function public.cancel_ticket_transfer_v1(target_transfer uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  update public.ticket_transfers set status='cancelled',cancelled_at=now(),updated_at=now() where id=target_transfer and status='pending' and (sender_id=auth.uid() or recipient_id=auth.uid());
  if not found then raise exception 'transfer unavailable'; end if;
  return jsonb_build_object('status','cancelled');
end$$;

create or replace function public.check_in_ticket_v1(target_ticket uuid,target_event uuid,expected_token_version integer,token_hash_value text,device_key text,scan_key uuid,scanned_at_value timestamptz,offline_scan boolean default false,rejection_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();t public.tickets%rowtype;checkin uuid;result_value text;message_value text;action_value text:=case when offline_scan then 'offline_sync' else 'scan' end;effective_time timestamptz:=coalesce(scanned_at_value,now());
begin
  if actor is null or not public.can_checkin_event(target_event) then raise exception 'not authorized'; end if;
  select * into t from public.tickets where id=target_ticket for update;
  if t.id is null or t.event_id<>target_event then result_value:='rejected';message_value:=left(coalesce(nullif(trim(rejection_reason),''),'Ticket is invalid or belongs to another event.'),500);
  elsif t.token_version<>expected_token_version or t.signed_code_hash<>token_hash_value then result_value:='rejected';message_value:='Ticket code was replaced or transferred.';
  elsif t.status in ('refunded','void') then result_value:='rejected';message_value:='Ticket is not active.';
  elsif t.checked_in_at is not null or t.status='checked_in' then result_value:='duplicate';message_value:='Ticket was already checked in.';
  else result_value:='checked_in';message_value:='Checked in successfully.';update public.tickets set status='checked_in',checked_in_at=effective_time,checked_in_by=actor,updated_at=now() where id=t.id; end if;
  insert into public.ticket_checkin_events(event_id,ticket_id,staff_id,device_id,scan_id,token_version,token_hash,action,result,reason,scanned_at,metadata)
  values(target_event,t.id,actor,left(coalesce(nullif(device_key,''),'unknown'),120),scan_key,expected_token_version,left(token_hash_value,64),action_value,result_value,message_value,effective_time,jsonb_build_object('offline',offline_scan))
  on conflict(staff_id,device_id,scan_id) do nothing returning id into checkin;
  if checkin is null then select id,result,reason into checkin,result_value,message_value from public.ticket_checkin_events where staff_id=actor and device_id=left(coalesce(nullif(device_key,''),'unknown'),120) and scan_id=scan_key; end if;
  return jsonb_build_object('checkin_id',checkin,'ticket_id',t.id,'ticket_number',t.ticket_number,'status',result_value,'message',message_value);
end$$;

create or replace function public.reverse_ticket_checkin_v1(target_event uuid,target_checkin uuid,reversal_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();prior public.ticket_checkin_events%rowtype;created uuid;
begin
  if actor is null or not public.can_checkin_event(target_event) then raise exception 'not authorized'; end if;
  select * into prior from public.ticket_checkin_events where id=target_checkin and event_id=target_event and result='checked_in';
  if prior.id is null or exists(select 1 from public.ticket_checkin_events c where c.action='reverse' and c.metadata->>'reverses'=prior.id::text) then raise exception 'check-in unavailable'; end if;
  update public.tickets set status='valid',checked_in_at=null,checked_in_by=null,updated_at=now() where id=prior.ticket_id and status='checked_in';
  insert into public.ticket_checkin_events(event_id,ticket_id,staff_id,device_id,scan_id,token_version,token_hash,action,result,reason,scanned_at,metadata) values(target_event,prior.ticket_id,actor,prior.device_id,gen_random_uuid(),prior.token_version,prior.token_hash,'reverse','reversed',left(coalesce(reversal_reason,'Staff reversal'),500),now(),jsonb_build_object('reverses',prior.id)) returning id into created;
  return jsonb_build_object('checkin_id',created,'status','reversed','ticket_id',prior.ticket_id);
end$$;

create or replace function public.lookup_event_tickets_v1(target_event uuid,search_term text)
returns table(ticket_id uuid,ticket_number text,status text,owner_name text,tier_name text,signed_token text)
language sql stable security definer set search_path=public as $$
  select t.id,t.ticket_number,t.status,coalesce(p.display_name,p.username,'Ticket holder'),tt.name,t.signed_token
  from public.tickets t join public.ticket_types tt on tt.id=t.ticket_type_id left join public.profiles p on p.id=t.owner_id left join public.orders o on o.id=t.order_id
  where t.event_id=target_event and public.can_checkin_event(target_event) and (trim(coalesce(search_term,''))='' or t.ticket_number ilike '%'||trim(search_term)||'%' or p.display_name ilike '%'||trim(search_term)||'%' or p.username ilike '%'||trim(leading '@' from search_term)||'%' or o.id::text ilike trim(search_term)||'%')
  order by t.ticket_number limit 50
$$;
