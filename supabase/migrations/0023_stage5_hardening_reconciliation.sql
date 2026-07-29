-- Stage 5E: transfer expiry, reconciliation, and terminal-state hardening.
-- Apply after 0022_stage5_management_authorization.sql.

create or replace function public.accept_ticket_transfer_v1(target_transfer uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare tr public.ticket_transfers%rowtype;t public.tickets%rowtype;
begin
  select * into tr from public.ticket_transfers where id=target_transfer for update;
  if tr.id is null or tr.recipient_id<>auth.uid() or tr.status<>'pending' or tr.expires_at<=now() then raise exception 'transfer unavailable'; end if;
  select * into t from public.tickets where id=tr.ticket_id for update;
  if t.owner_id<>tr.sender_id or t.status not in ('valid','transferred') or t.checked_in_at is not null then raise exception 'ticket transfer is no longer valid'; end if;
  update public.tickets set owner_id=tr.recipient_id,status='valid',token_version=token_version+1,signed_token=null,signed_at=null,transferred_at=now(),updated_at=now() where id=t.id;
  update public.ticket_transfers set status='accepted',accepted_at=now(),updated_at=now() where id=tr.id;
  return jsonb_build_object('transfer_id',tr.id,'ticket_id',t.id,'status','accepted');
end$$;

create or replace function public.request_ticket_transfer_v1(target_ticket uuid,recipient_username text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();t public.tickets%rowtype;recipient uuid;created uuid;
begin
  select * into t from public.tickets where id=target_ticket and owner_id=actor for update;
  if t.id is null or t.status not in ('valid','transferred') or t.checked_in_at is not null then raise exception 'ticket cannot be transferred'; end if;
  select id into recipient from public.profiles where lower(username)=lower(trim(leading '@' from recipient_username)) and suspended_at is null;
  if recipient is null or recipient=actor then raise exception 'recipient unavailable'; end if;
  if exists(select 1 from public.blocks where (blocker_id=actor and blocked_id=recipient) or (blocker_id=recipient and blocked_id=actor)) then raise exception 'recipient unavailable'; end if;
  insert into public.ticket_transfers(ticket_id,sender_id,recipient_id) values(t.id,actor,recipient) returning id into created;
  return jsonb_build_object('transfer_id',created,'status','pending');
end$$;

create or replace function public.expire_ticket_transfers_v1(batch_size integer default 500)
returns integer language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
  if auth.role()<>'service_role' then raise exception 'service role required'; end if;
  with due as (select id from public.ticket_transfers where status='pending' and expires_at<=now() order by expires_at limit greatest(1,least(batch_size,5000)) for update skip locked)
  update public.ticket_transfers t set status='expired',updated_at=now() from due where t.id=due.id;
  get diagnostics changed=row_count;return changed;
end$$;

create or replace function public.run_stage5_reconciliation_v1(run_mode text default 'automated')
returns uuid language plpgsql security definer set search_path=public as $$
declare created_run uuid;differences integer;
begin
  if auth.role()<>'service_role' and not public.is_admin() then raise exception 'not authorized'; end if;
  insert into public.reconciliation_runs(started_by,mode) values(auth.uid(),case when run_mode in ('automated','manual','test') then run_mode else 'automated' end) returning id into created_run;
  insert into public.reconciliation_items(run_id,item_type,local_reference,expected_cents,actual_cents,status,details)
  select created_run,'journal_balance',j.id::text,0,coalesce(sum(e.amount_cents),0),case when coalesce(sum(e.amount_cents),0)=0 then 'matched' else 'amount_mismatch' end,jsonb_build_object('journal_type',j.journal_type)
  from public.ledger_journals j left join public.ledger_entries e on e.journal_id=j.id group by j.id,j.journal_type;
  insert into public.reconciliation_items(run_id,item_type,local_reference,stripe_reference,expected_cents,actual_cents,status,details)
  select created_run,'paid_order_ledger',o.id::text,o.stripe_charge_id,o.amount_total_cents,coalesce((select sum(le.amount_cents) from public.ledger_entries le join public.ledger_journals lj on lj.id=le.journal_id where lj.order_id=o.id and lj.journal_type='order_paid' and le.account_code='stripe_cash'),0),case when o.amount_total_cents=coalesce((select sum(le.amount_cents) from public.ledger_entries le join public.ledger_journals lj on lj.id=le.journal_id where lj.order_id=o.id and lj.journal_type='order_paid' and le.account_code='stripe_cash'),0) then 'matched' else 'amount_mismatch' end,'{}'::jsonb
  from public.orders o where o.status in ('paid','partially_refunded','refunded','disputed','fraud_hold');
  insert into public.reconciliation_items(run_id,item_type,local_reference,expected_cents,actual_cents,status,details)
  select created_run,'ticket_count',o.id::text,coalesce((select sum(quantity) from public.order_items where order_id=o.id),0),coalesce((select count(*) from public.tickets where order_id=o.id),0),case when coalesce((select sum(quantity) from public.order_items where order_id=o.id),0)=coalesce((select count(*) from public.tickets where order_id=o.id),0) then 'matched' else 'amount_mismatch' end,'{}'::jsonb
  from public.orders o where o.status in ('paid','partially_refunded','refunded','disputed','fraud_hold');
  select count(*) into differences from public.reconciliation_items where reconciliation_items.run_id=created_run and status<>'matched';
  update public.reconciliation_runs set status=case when differences=0 then 'balanced' else 'differences' end,completed_at=now(),summary=jsonb_build_object('differences',differences,'items',(select count(*) from public.reconciliation_items where reconciliation_items.run_id=created_run)) where id=created_run;
  return created_run;
end$$;

revoke all on function public.accept_ticket_transfer_v1(uuid),public.request_ticket_transfer_v1(uuid,text) from public,anon;
grant execute on function public.accept_ticket_transfer_v1(uuid),public.request_ticket_transfer_v1(uuid,text) to authenticated;
revoke all on function public.expire_ticket_transfers_v1(integer),public.run_stage5_reconciliation_v1(text) from public,anon,authenticated;
grant execute on function public.expire_ticket_transfers_v1(integer),public.run_stage5_reconciliation_v1(text) to service_role;
