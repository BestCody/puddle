-- Stage 9B: moderation workflows, evidence preservation, appeals, bulk operations, and dashboards.
create or replace function public.privileged_roles_v1(actor uuid default auth.uid()) returns text[] language sql stable security definer set search_path=public as $$
  select coalesce(array_agg(distinct role_key),array[]::text[]) from (
    select pra.role_key from public.privileged_role_assignments pra where pra.profile_id=actor and pra.revoked_at is null and (pra.expires_at is null or pra.expires_at>now())
    union all select case p.role::text when 'admin' then 'super_admin' when 'moderator' then 'content_moderator' when 'support' then 'support' when 'finance' then 'finance_ops' end from public.profiles p where p.id=actor and p.suspended_at is null and p.banned_at is null
  ) roles where role_key is not null
$$;

create or replace function public.privileged_access_v1(required_roles text[] default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=auth.uid();roles text[];
begin
  if actor is null then return jsonb_build_object('allowed',false,'roles','[]'::jsonb,'mfa_required',true); end if;
  roles:=public.privileged_roles_v1(actor);
  return jsonb_build_object('allowed',cardinality(roles)>0 and (required_roles is null or cardinality(required_roles)=0 or roles && required_roles),'roles',to_jsonb(roles),'mfa_required',true,'mfa_satisfied',coalesce(auth.jwt()->>'aal','aal1')='aal2');
end$$;

create or replace function public.has_privileged_role_v1(required_roles text[]) returns boolean language sql stable security definer set search_path=public as $$select coalesce(public.privileged_roles_v1(auth.uid()) && required_roles,false) and coalesce(auth.jwt()->>'aal','aal1')='aal2'$$;

create or replace function public.prepare_moderation_case_v1() returns trigger language plpgsql set search_path=public as $$
declare minutes integer;policy public.moderation_sla_policies%rowtype;
begin
  new.priority_rank:=case new.priority when 'emergency' then 0 when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end;
  select * into policy from public.moderation_sla_policies where category=new.category;
  if policy.category is null then select * into policy from public.moderation_sla_policies where category='default'; end if;
  minutes:=case new.priority when 'emergency' then policy.emergency_minutes when 'urgent' then policy.urgent_minutes when 'high' then policy.high_minutes when 'normal' then policy.normal_minutes else policy.low_minutes end;
  new.sla_due_at:=coalesce(new.sla_due_at,now()+make_interval(mins=>minutes));new.updated_at:=now();return new;
end$$;
drop trigger if exists moderation_cases_prepare on public.moderation_cases;
create trigger moderation_cases_prepare before insert or update of priority,category,state on public.moderation_cases for each row execute function public.prepare_moderation_case_v1();

create or replace function public.write_security_audit_v1(actor_id_value uuid,action_value text,target_type_value text,target_id_value text,before_value jsonb,after_value jsonb,reason_value text,request_id_value text,ip_hash_value text,user_agent_hash_value text) returns bigint language plpgsql security definer set search_path=public as $$
declare prior text;created bigint;hash_value text;created_time timestamptz:=clock_timestamp();normalized_action text:=left(action_value,160);normalized_type text:=left(target_type_value,80);normalized_target text:=left(target_id_value,200);normalized_reason text:=left(reason_value,2000);normalized_request text:=left(request_id_value,120);
begin
  perform pg_advisory_xact_lock(hashtext('puddle-security-audit-chain'));
  select event_hash into prior from public.security_audit_events order by id desc limit 1;
  hash_value:=encode(digest(coalesce(prior,'')||'|'||coalesce(actor_id_value::text,'system')||'|'||normalized_action||'|'||normalized_type||'|'||coalesce(normalized_target,'')||'|'||coalesce(before_value,'null'::jsonb)::text||'|'||coalesce(after_value,'null'::jsonb)::text||'|'||coalesce(normalized_reason,'')||'|'||coalesce(normalized_request,'')||'|'||extract(epoch from created_time)::text,'sha256'),'hex');
  insert into public.security_audit_events(actor_id,action,target_type,target_id,before_data,after_data,reason,request_id,ip_hash,user_agent_hash,created_at,previous_hash,event_hash) values(actor_id_value,normalized_action,normalized_type,normalized_target,before_value,after_value,normalized_reason,normalized_request,ip_hash_value,user_agent_hash_value,created_time,prior,hash_value) returning id into created;
  return created;
end$$;

create or replace function public.protect_security_audit_v1() returns trigger language plpgsql as $$begin raise exception 'security audit events are immutable';end$$;
drop trigger if exists security_audit_immutable on public.security_audit_events;
create trigger security_audit_immutable before update or delete on public.security_audit_events for each row execute function public.protect_security_audit_v1();

create or replace function public.record_security_event_v1(actor_id_value uuid,event_type_value text,severity_value text,target_type_value text,target_id_value text,request_id_value text,ip_hash_value text,device_hash_value text,user_agent_hash_value text,event_metadata jsonb) returns bigint language plpgsql security definer set search_path=public as $$
declare created bigint;recent integer;
begin
  insert into public.security_events(actor_id,event_type,severity,target_type,target_id,request_id,ip_hash,device_hash,user_agent_hash,metadata) values(actor_id_value,left(event_type_value,120),case when severity_value in('info','notice','warning','high','critical') then severity_value else 'info' end,left(target_type_value,80),left(target_id_value,200),left(request_id_value,120),ip_hash_value,device_hash_value,user_agent_hash_value,coalesce(event_metadata,'{}')) returning id into created;
  if severity_value in('high','critical') then insert into public.security_alerts(title,severity,source_event_id,metadata) values(left(replace(event_type_value,'_',' '),240),severity_value,created,coalesce(event_metadata,'{}')); end if;
  if actor_id_value is not null then select count(*) into recent from public.security_events where actor_id=actor_id_value and severity in('high','critical') and created_at>now()-interval '1 hour';if recent>=3 then update public.profiles set risk_score=least(1000,risk_score+10) where id=actor_id_value;end if;end if;
  return created;
end$$;

create or replace function public.report_social_target_v2(target_kind text,target_value text,report_category text,report_details text,risk_context jsonb default '{}'::jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();report_id bigint;case_id uuid;priority_value text:='normal';queue_value text:='general';
begin
  if actor is null then raise exception 'authentication required'; end if;
  if target_kind not in('event','location','host','profile','conversation','message','comment','plan','ticket','order','payment') then raise exception 'invalid report target';end if;
  if report_category in('unsafe_or_illegal','fraud_or_impersonation','privacy') then priority_value:='high';end if;
  if report_category='unsafe_or_illegal' then queue_value:='safety';elsif target_kind in('ticket','order','payment') then queue_value:='payments';elsif target_kind in('host','location') then queue_value:='verification';else queue_value:='content';end if;
  insert into public.social_reports(reporter_id,target_type,target_id,category,details,evidence,status) values(actor,target_kind,target_value,report_category,left(report_details,3000),coalesce(risk_context,'{}'),'open') returning id into report_id;
  insert into public.moderation_cases(title,summary,category,priority,queue_key,subject_type,subject_id,reporter_id,source_report_type,source_report_id,created_by) values('Report: '||replace(report_category,'_',' '),left(report_details,4000),case when queue_value='payments' then 'payments' when queue_value='verification' then 'verification' else 'safety' end,priority_value,queue_value,target_kind,target_value,actor,'social_reports',report_id::text,actor) returning id into case_id;
  perform public.preserve_case_evidence_v1(case_id,target_kind,target_value);
  return case_id;
end$$;

create or replace function public.preserve_case_evidence_v1(target_case uuid,source_type_value text,source_id_value text) returns uuid language plpgsql security definer set search_path=public as $$
declare snapshot_value jsonb;created uuid;asset uuid;hash_value text;
begin
  if not public.has_privileged_role_v1(array['super_admin','trust_safety','content_moderator','security','support','finance_ops','verification']) and not exists(select 1 from public.moderation_cases where id=target_case and created_by=auth.uid()) then raise exception 'not authorized';end if;
  if source_type_value='media' then begin asset:=source_id_value::uuid;exception when invalid_text_representation then asset:=null;end;end if;
  snapshot_value:=case source_type_value
    when 'message' then (select to_jsonb(m) from public.messages m where m.id::text=source_id_value)
    when 'comment' then (select to_jsonb(c) from public.social_comments c where c.id::text=source_id_value)
    when 'conversation' then (select to_jsonb(c) from public.conversations c where c.id::text=source_id_value)
    when 'event' then (select to_jsonb(e) from public.events e where e.id::text=source_id_value)
    when 'location' then (select to_jsonb(l) from public.locations l where l.id::text=source_id_value)
    when 'verification_document' then (select to_jsonb(v) from public.verification_documents v where v.id::text=source_id_value)
    when 'location_claim' then (select to_jsonb(c) from public.location_claims c where c.id::text=source_id_value)
    when 'host' then (select to_jsonb(h) from public.host_profiles h where h.id::text=source_id_value)
    when 'profile' then (select (to_jsonb(p)-'birth_date'-'home_point'-'latitude'-'longitude') from public.profiles p where p.id::text=source_id_value)
    when 'plan' then (select to_jsonb(p) from public.plans p where p.id::text=source_id_value)
    when 'media' then (select to_jsonb(m) from public.media_assets m where m.id::text=source_id_value)
    when 'ticket' then (select to_jsonb(t) from public.tickets t where t.id::text=source_id_value)
    when 'order' then (select to_jsonb(o) from public.orders o where o.id::text=source_id_value)
    when 'payment' then (select to_jsonb(o) from public.orders o where o.id::text=source_id_value)
    when 'refund' then (select to_jsonb(r) from public.refund_requests r where r.id::text=source_id_value)
    when 'dispute' then (select to_jsonb(d) from public.stripe_disputes d where d.id::text=source_id_value)
    when 'payout' then (select to_jsonb(p) from public.stripe_payouts p where p.id::text=source_id_value)
    else jsonb_build_object('source_type',source_type_value,'source_id',source_id_value,'unavailable',true)
  end;
  if snapshot_value is null then snapshot_value:=jsonb_build_object('source_type',source_type_value,'source_id',source_id_value,'missing',true);end if;
  hash_value:=encode(digest(snapshot_value::text,'sha256'),'hex');
  insert into public.moderation_case_evidence(case_id,source_type,source_id,snapshot,media_asset_id,sha256,preserved_by,retention_until) values(target_case,source_type_value,source_id_value,snapshot_value,asset,hash_value,auth.uid(),now()+interval '2 years') on conflict(case_id,source_type,source_id,sha256) do update set legal_hold=true returning id into created;
  return created;
end$$;

create or replace function public.open_moderation_case_v1(subject_type_value text,subject_id_value text,case_title text,case_summary text,case_category text,case_priority text,queue_value text,request_id_value text) returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();created uuid;
begin
  if not public.has_privileged_role_v1(array['super_admin','trust_safety','content_moderator','verification','support','finance_ops','security','incident_commander']) then raise exception 'not authorized';end if;
  if subject_type_value not in('event','location','host','profile','conversation','message','comment','plan','location_claim','verification_document','media','ticket','order','payment','refund','dispute','payout') then raise exception 'invalid subject type';end if;
  if case_priority not in('low','normal','high','urgent','emergency') then raise exception 'invalid priority';end if;
  if queue_value not in('general','content','safety','verification','payments','appeals','security','emergency') then raise exception 'invalid queue';end if;
  if char_length(trim(case_title))<3 or char_length(trim(coalesce(case_summary,'')))<8 then raise exception 'case context required';end if;
  insert into public.moderation_cases(title,summary,category,priority,queue_key,subject_type,subject_id,created_by)
  values(left(case_title,240),left(case_summary,4000),left(case_category,80),case_priority,queue_value,subject_type_value,left(subject_id_value,200),actor) returning id into created;
  perform public.preserve_case_evidence_v1(created,subject_type_value,subject_id_value);
  perform public.write_security_audit_v1(actor,'moderation_case_opened',subject_type_value,subject_id_value,null,jsonb_build_object('case_id',created,'priority',case_priority,'queue',queue_value),case_summary,request_id_value,null,null);
  return created;
end$$;

create table if not exists public.bulk_operations (
  id uuid primary key default gen_random_uuid(),event_id uuid references public.events(id) on delete restrict,operation text not null,status text not null default 'queued',reason text not null,requested_by uuid references public.profiles(id),request_id text,created_at timestamptz not null default now(),started_at timestamptz,completed_at timestamptz,summary jsonb not null default '{}'::jsonb
);
create table if not exists public.bulk_operation_items (
  id bigint generated always as identity primary key,operation_id uuid not null references public.bulk_operations(id) on delete cascade,item_type text not null,item_id text not null,status text not null default 'queued',attempts integer not null default 0,result jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),completed_at timestamptz,unique(operation_id,item_type,item_id)
);
alter table public.refund_requests add column if not exists bulk_operation_item_id bigint references public.bulk_operation_items(id) on delete restrict;
create unique index if not exists refund_requests_bulk_item_unique on public.refund_requests(bulk_operation_item_id) where bulk_operation_item_id is not null;

create or replace function public.queue_bulk_event_operation_v1(target_event uuid,operation_name text,operation_reason text,request_id_value text) returns uuid language plpgsql security definer set search_path=public as $$
declare created uuid;actor uuid:=auth.uid();
begin
  if not public.has_privileged_role_v1(array['super_admin','finance_ops','incident_commander']) then raise exception 'not authorized';end if;
  if operation_name not in('notify_attendees','refund_all','cancel_notify','cancel_refund_notify') then raise exception 'invalid operation';end if;
  if char_length(trim(operation_reason))<8 then raise exception 'reason required';end if;
  insert into public.bulk_operations(event_id,operation,reason,requested_by,request_id) values(target_event,operation_name,left(operation_reason,2000),actor,left(request_id_value,120)) returning id into created;
  if operation_name in('notify_attendees','cancel_notify','cancel_refund_notify') then insert into public.bulk_operation_items(operation_id,item_type,item_id) select created,'attendee',profile_id::text from public.event_rsvps where event_id=target_event and status in('going','checked_in','interested','waitlisted','requested') on conflict do nothing;end if;
  if operation_name in('refund_all','cancel_refund_notify') then insert into public.bulk_operation_items(operation_id,item_type,item_id) select created,'order',id::text from public.orders where event_id=target_event and status in('paid','partially_refunded') on conflict do nothing;end if;
  if operation_name in('cancel_notify','cancel_refund_notify') then perform set_config('puddle.allow_status_transition','on',true);update public.events set status='cancelled',cancelled_at=coalesce(cancelled_at,now()),moderation_reason=left(operation_reason,2000) where id=target_event;end if;
  perform public.write_security_audit_v1(actor,'bulk_operation_queued','event',target_event::text,null,jsonb_build_object('operation',operation_name,'id',created),operation_reason,request_id_value,null,null);
  return created;
end$$;

create or replace function public.submit_moderation_appeal_v1(case_number_value text,appeal_statement text,request_id_value text) returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();target public.moderation_cases%rowtype;created uuid;
begin
  if actor is null then raise exception 'authentication required';end if;select * into target from public.moderation_cases where case_number=upper(case_number_value) and (subject_id=actor::text or reporter_id=actor);if target.id is null then raise exception 'case unavailable';end if;
  insert into public.moderation_appeals(case_id,appellant_id,statement) values(target.id,actor,left(appeal_statement,5000)) returning id into created;update public.moderation_cases set state='appealed',queue_key='appeals',updated_at=now() where id=target.id;perform public.write_security_audit_v1(actor,'appeal_submitted','moderation_case',target.id::text,null,jsonb_build_object('appeal_id',created),null,request_id_value,null,null);return created;
end$$;

create or replace function public.active_system_notices_v1() returns table(id uuid,title text,body text,severity text) language sql stable security definer set search_path=public as $$
select n.id,n.title,n.body,n.severity from public.system_notices n
where n.active and n.starts_at<=now() and (n.ends_at is null or n.ends_at>now()) and (
  n.audience='all'
  or (auth.uid() is not null and n.audience in('authenticated','attendees'))
  or (n.audience='hosts' and exists(select 1 from public.host_members hm where hm.profile_id=auth.uid() and hm.accepted_at is not null))
  or (n.audience='staff' and cardinality(public.privileged_roles_v1(auth.uid()))>0)
)
order by case n.severity when 'critical' then 0 when 'warning' then 1 else 2 end,n.starts_at desc limit 5
$$;
