-- Stage 9E: worker queues, SLA/anomaly alerts, legacy audit immutability, feature flag governance, and privileged role management.
alter table public.feature_flags add column if not exists risk_tier text not null default 'normal';
alter table public.feature_flags add column if not exists requires_incident_approval boolean not null default false;
alter table public.feature_flags add column if not exists updated_by uuid references public.profiles(id) on delete set null;


create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(auth.jwt()->>'aal','aal1')='aal2' and exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','moderator') and suspended_at is null and banned_at is null)
$$;

create or replace function public.protect_stage9_sensitive_fields_v1() returns trigger language plpgsql security definer set search_path=public as $$
declare privileged boolean:=coalesce(auth.role(),'')='service_role' or public.has_privileged_role_v1(array['super_admin','trust_safety','content_moderator','verification','security','incident_commander','finance_ops']);
begin
  if tg_table_name='profiles' then
    if new.role is distinct from old.role or new.account_kind is distinct from old.account_kind or new.age_verified_at is distinct from old.age_verified_at or new.suspended_at is distinct from old.suspended_at or new.banned_at is distinct from old.banned_at or new.ban_reason is distinct from old.ban_reason or new.moderation_state is distinct from old.moderation_state or new.risk_score is distinct from old.risk_score then if not privileged then raise exception 'privileged profile fields cannot be changed';end if;end if;
  elsif tg_table_name='host_profiles' then
    if new.payout_frozen_at is distinct from old.payout_frozen_at or new.payout_freeze_reason is distinct from old.payout_freeze_reason or new.delisted_at is distinct from old.delisted_at or new.moderation_state is distinct from old.moderation_state or new.created_by is distinct from old.created_by or ((old.status='suspended' or new.status='suspended') and new.status is distinct from old.status) then if not privileged then raise exception 'privileged host fields cannot be changed';end if;end if;
    if new.verification_status is distinct from old.verification_status and not privileged then if not (new.verification_status='pending' and old.verification_status in('unverified','rejected') and public.has_host_role(new.id,array['owner'])) then raise exception 'verification status cannot be changed';end if;end if;
  elsif tg_table_name='events' then
    if new.delisted_at is distinct from old.delisted_at or new.moderation_hold_at is distinct from old.moderation_hold_at or new.moderation_reason is distinct from old.moderation_reason then if not privileged then raise exception 'event moderation fields cannot be changed';end if;end if;
  elsif tg_table_name='locations' then
    if new.delisted_at is distinct from old.delisted_at or new.moderation_hold_at is distinct from old.moderation_hold_at or new.moderation_reason is distinct from old.moderation_reason then if not privileged then raise exception 'location moderation fields cannot be changed';end if;end if;
  elsif tg_table_name='conversations' then
    if new.moderation_state is distinct from old.moderation_state or new.moderated_at is distinct from old.moderated_at or new.moderated_by is distinct from old.moderated_by or new.moderation_reason is distinct from old.moderation_reason then if not privileged then raise exception 'conversation moderation fields cannot be changed';end if;end if;
  elsif tg_table_name='messages' then
    if new.moderator_removed_at is distinct from old.moderator_removed_at or new.moderator_removed_by is distinct from old.moderator_removed_by or new.moderator_reason is distinct from old.moderator_reason or (new.state='moderator_removed' and new.state is distinct from old.state) then if not privileged then raise exception 'message moderation fields cannot be changed';end if;end if;
  elsif tg_table_name='social_comments' then
    if new.moderator_removed_at is distinct from old.moderator_removed_at or new.moderator_removed_by is distinct from old.moderator_removed_by or new.moderator_reason is distinct from old.moderator_reason then if not privileged then raise exception 'comment moderation fields cannot be changed';end if;end if;
  elsif tg_table_name='media_assets' then
    if new.scan_status is distinct from old.scan_status or new.scanner is distinct from old.scanner or new.status is distinct from old.status or new.approved_at is distinct from old.approved_at or new.rejected_at is distinct from old.rejected_at or new.evidence_hold_at is distinct from old.evidence_hold_at or new.malware_scan_provider is distinct from old.malware_scan_provider or new.malware_scan_result is distinct from old.malware_scan_result or new.scan_completed_at is distinct from old.scan_completed_at then if not privileged then raise exception 'media security fields cannot be changed';end if;end if;
  elsif tg_table_name='location_claims' then
    if new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at or new.review_note is distinct from old.review_note or (new.status is distinct from old.status and new.status<>'withdrawn') then if not privileged then raise exception 'claim review fields cannot be changed';end if;end if;
  elsif tg_table_name='verification_documents' then
    if new.review_status is distinct from old.review_status or new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at then if not privileged then raise exception 'verification review fields cannot be changed';end if;end if;
  end if;
  return new;
end$$;

revoke all on function public.protect_stage9_sensitive_fields_v1() from public,anon,authenticated;

drop trigger if exists profiles_stage9_sensitive_guard on public.profiles;
create trigger profiles_stage9_sensitive_guard before update on public.profiles for each row execute function public.protect_stage9_sensitive_fields_v1();
drop trigger if exists hosts_stage9_sensitive_guard on public.host_profiles;
create trigger hosts_stage9_sensitive_guard before update on public.host_profiles for each row execute function public.protect_stage9_sensitive_fields_v1();
drop trigger if exists events_stage9_sensitive_guard on public.events;
create trigger events_stage9_sensitive_guard before update on public.events for each row execute function public.protect_stage9_sensitive_fields_v1();
drop trigger if exists locations_stage9_sensitive_guard on public.locations;
create trigger locations_stage9_sensitive_guard before update on public.locations for each row execute function public.protect_stage9_sensitive_fields_v1();
drop trigger if exists conversations_stage9_sensitive_guard on public.conversations;
create trigger conversations_stage9_sensitive_guard before update on public.conversations for each row execute function public.protect_stage9_sensitive_fields_v1();
drop trigger if exists messages_stage9_sensitive_guard on public.messages;
create trigger messages_stage9_sensitive_guard before update on public.messages for each row execute function public.protect_stage9_sensitive_fields_v1();
drop trigger if exists comments_stage9_sensitive_guard on public.social_comments;
create trigger comments_stage9_sensitive_guard before update on public.social_comments for each row execute function public.protect_stage9_sensitive_fields_v1();
drop trigger if exists media_stage9_sensitive_guard on public.media_assets;
create trigger media_stage9_sensitive_guard before update on public.media_assets for each row execute function public.protect_stage9_sensitive_fields_v1();
drop trigger if exists claims_stage9_sensitive_guard on public.location_claims;
create trigger claims_stage9_sensitive_guard before update on public.location_claims for each row execute function public.protect_stage9_sensitive_fields_v1();
drop trigger if exists verification_documents_stage9_sensitive_guard on public.verification_documents;
create trigger verification_documents_stage9_sensitive_guard before update on public.verification_documents for each row execute function public.protect_stage9_sensitive_fields_v1();

create or replace function public.protect_legacy_audit_v1() returns trigger language plpgsql as $$begin raise exception 'audit logs are immutable';end$$;
drop trigger if exists audit_logs_immutable_stage9 on public.audit_logs;
create trigger audit_logs_immutable_stage9 before update or delete on public.audit_logs for each row execute function public.protect_legacy_audit_v1();

create or replace function public.claim_bulk_operation_items_v1(batch_size integer default 25) returns table(id bigint,operation_id uuid,item_type text,item_id text,event_id uuid,operation text,reason text) language plpgsql security definer set search_path=public as $$begin if auth.role()<>'service_role' then raise exception 'service role required';end if;return query with claimed as(select i.id from public.bulk_operation_items i join public.bulk_operations o on o.id=i.operation_id where i.status in('queued','failed') and i.attempts<8 and o.status in('queued','processing') order by i.id limit greatest(1,least(batch_size,100)) for update skip locked) update public.bulk_operation_items i set status='processing',attempts=i.attempts+1 from claimed c,public.bulk_operations o where i.id=c.id and o.id=i.operation_id returning i.id,i.operation_id,i.item_type,i.item_id,o.event_id,o.operation,o.reason;end$$;
create or replace function public.complete_bulk_operation_item_v1(target_item bigint,succeeded boolean,result_value jsonb,error_value text) returns boolean language plpgsql security definer set search_path=public as $$declare op uuid;remaining integer;failed_count integer;begin if auth.role()<>'service_role' then raise exception 'service role required';end if;update public.bulk_operation_items set status=case when succeeded then 'completed' else 'failed' end,result=coalesce(result_value,'{}')||case when error_value is null then '{}'::jsonb else jsonb_build_object('error',left(error_value,500)) end,completed_at=case when succeeded then now() else null end where id=target_item returning operation_id into op;if op is null then return false;end if;update public.bulk_operations set status='processing',started_at=coalesce(started_at,now()) where id=op and status='queued';select count(*) into remaining from public.bulk_operation_items where operation_id=op and (status in('queued','processing') or (status='failed' and attempts<8));select count(*) into failed_count from public.bulk_operation_items where operation_id=op and status='failed';if remaining=0 then update public.bulk_operations set status=case when failed_count>0 then 'failed' else 'completed' end,completed_at=now(),summary=(select jsonb_build_object('completed',count(*) filter(where status='completed'),'failed',count(*) filter(where status='failed'),'skipped',count(*) filter(where status='skipped')) from public.bulk_operation_items where operation_id=op) where id=op;end if;return true;end$$;

create or replace function public.run_moderation_sla_alerts_v1() returns integer language plpgsql security definer set search_path=public as $$declare affected integer;begin if auth.role()<>'service_role' then raise exception 'service role required';end if;with breached as(update public.moderation_cases set sla_breached_at=coalesce(sla_breached_at,now()),priority=case when priority='low' then 'normal' when priority='normal' then 'high' when priority='high' then 'urgent' else priority end where state not in('resolved','dismissed','closed') and sla_due_at<now() returning id,case_number,priority) insert into public.security_alerts(title,severity,metadata) select 'Moderation SLA breached: '||case_number,case when priority in('urgent','emergency') then 'high' else 'warning' end,jsonb_build_object('case_id',id) from breached;get diagnostics affected=row_count;return affected;end$$;

create or replace function public.detect_security_anomalies_v1() returns integer language plpgsql security definer set search_path=public as $$declare created integer:=0;begin if auth.role()<>'service_role' then raise exception 'service role required';end if;insert into public.security_alerts(title,severity,metadata) select 'Repeated high-severity events for account','high',jsonb_build_object('actor_id',actor_id,'count',count(*)) from public.security_events where actor_id is not null and severity in('high','critical') and created_at>now()-interval '1 hour' group by actor_id having count(*)>=5 and not exists(select 1 from public.security_alerts a where a.title='Repeated high-severity events for account' and a.metadata->>'actor_id'=security_events.actor_id::text and a.created_at>now()-interval '1 hour');get diagnostics created=row_count;return created;end$$;

drop policy if exists "admins manage feature flags" on public.feature_flags;
revoke insert,update,delete on public.feature_flags from authenticated;

create or replace function public.record_abuse_risk_signal_v1(profile_value uuid,host_value uuid,signal_type_value text,score_delta_value integer,confidence_value numeric,source_value text,metadata_value jsonb) returns bigint language plpgsql security definer set search_path=public as $$
declare created bigint;
begin
  if auth.role()<>'service_role' then raise exception 'service role required';end if;
  if num_nonnulls(profile_value,host_value)=0 then raise exception 'risk target required';end if;
  insert into public.abuse_risk_signals(profile_id,host_profile_id,signal_type,score_delta,confidence,source,metadata) values(profile_value,host_value,left(signal_type_value,120),greatest(-1000,least(1000,score_delta_value)),greatest(0,least(1,confidence_value)),left(source_value,120),coalesce(metadata_value,'{}')) returning id into created;
  if profile_value is not null then update public.profiles set risk_score=greatest(0,least(1000,risk_score+score_delta_value)) where id=profile_value;end if;
  return created;
end$$;

create or replace function public.record_linked_account_signal_v1(profile_a_value uuid,profile_b_value uuid,signal_type_value text,confidence_value numeric,signal_hash_value text,metadata_value jsonb) returns bigint language plpgsql security definer set search_path=public as $$
declare left_profile uuid:=least(profile_a_value,profile_b_value);right_profile uuid:=greatest(profile_a_value,profile_b_value);created bigint;
begin
  if auth.role()<>'service_role' then raise exception 'service role required';end if;
  if left_profile is null or right_profile is null or left_profile=right_profile then raise exception 'two profiles required';end if;
  insert into public.linked_account_signals(profile_a,profile_b,signal_type,confidence,signal_hash,metadata) values(left_profile,right_profile,left(signal_type_value,120),greatest(0,least(1,confidence_value)),left(signal_hash_value,160),coalesce(metadata_value,'{}')) on conflict(profile_a,profile_b,signal_type,signal_hash) do update set confidence=greatest(public.linked_account_signals.confidence,excluded.confidence),metadata=public.linked_account_signals.metadata||excluded.metadata returning id into created;
  if confidence_value>=0.8 then perform public.record_security_event_v1(left_profile,'linked_account_signal','high','profile',right_profile::text,null,null,null,null,jsonb_build_object('signal_id',created,'signal_type',signal_type_value,'confidence',confidence_value));end if;
  return created;
end$$;

create or replace function public.manage_security_alert_v1(target_alert uuid,action_value text,reason_value text,request_id_value text) returns boolean language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();prior public.security_alerts%rowtype;next_state text;
begin
  if not public.has_privileged_role_v1(array['super_admin','security','incident_commander']) then raise exception 'not authorized';end if;
  if action_value not in('acknowledge','investigate','resolve','dismiss') then raise exception 'invalid action';end if;
  if action_value in('resolve','dismiss') and char_length(trim(reason_value))<8 then raise exception 'reason required';end if;
  select * into prior from public.security_alerts where id=target_alert for update;if prior.id is null then raise exception 'alert unavailable';end if;
  next_state:=case action_value when 'acknowledge' then 'acknowledged' when 'investigate' then 'investigating' when 'resolve' then 'resolved' else 'dismissed' end;
  update public.security_alerts set state=next_state,assigned_to=case when next_state in('acknowledged','investigating') then actor else assigned_to end,resolved_at=case when next_state in('resolved','dismissed') then now() else null end,metadata=metadata||jsonb_build_object('last_reason',left(reason_value,1000),'last_actor',actor,'last_action',action_value) where id=prior.id;
  perform public.write_security_audit_v1(actor,'security_alert_'||action_value,'security_alert',prior.id::text,to_jsonb(prior),jsonb_build_object('state',next_state),reason_value,request_id_value,null,null);
  return true;
end$$;

create or replace function public.set_feature_flag_v1(flag_key_value text,enabled_value boolean,config_value jsonb,reason_value text,request_id_value text) returns boolean language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();prior public.feature_flags%rowtype;after_value jsonb;
begin
  if not public.has_privileged_role_v1(array['super_admin','security','incident_commander']) then raise exception 'not authorized';end if;
  select * into prior from public.feature_flags where key=flag_key_value for update;if prior.key is null then raise exception 'feature flag unavailable';end if;
  if prior.requires_incident_approval and not public.has_privileged_role_v1(array['super_admin','incident_commander']) then raise exception 'incident commander approval required';end if;
  if char_length(trim(reason_value))<8 then raise exception 'reason required';end if;
  update public.feature_flags f set enabled=enabled_value,config=coalesce(config_value,f.config),updated_by=actor,updated_at=now() where f.key=prior.key returning to_jsonb(f) into after_value;
  perform public.write_security_audit_v1(actor,'feature_flag_changed','feature_flag',prior.key,to_jsonb(prior),after_value,reason_value,request_id_value,null,null);
  return true;
end$$;

create or replace function public.set_system_notice_v1(notice_id uuid,notice_title text,notice_body text,notice_severity text,notice_audience text,starts_at_value timestamptz,ends_at_value timestamptz,enabled boolean,request_id_value text) returns uuid language plpgsql security definer set search_path=public as $$declare actor uuid:=auth.uid();created uuid;begin if not public.has_privileged_role_v1(array['super_admin','support','incident_commander']) then raise exception 'not authorized';end if;insert into public.system_notices(id,title,body,severity,audience,starts_at,ends_at,active,created_by) values(coalesce(notice_id,gen_random_uuid()),left(notice_title,240),left(notice_body,2000),notice_severity,notice_audience,coalesce(starts_at_value,now()),ends_at_value,enabled,actor) on conflict(id) do update set title=excluded.title,body=excluded.body,severity=excluded.severity,audience=excluded.audience,starts_at=excluded.starts_at,ends_at=excluded.ends_at,active=excluded.active returning id into created;perform public.write_security_audit_v1(actor,'system_notice_changed','system_notice',created::text,null,jsonb_build_object('active',enabled,'severity',notice_severity),null,request_id_value,null,null);return created;end$$;

create or replace function public.manage_privileged_role_v1(target_profile uuid,role_value text,enabled boolean,reason_value text,request_id_value text) returns boolean language plpgsql security definer set search_path=public as $$declare actor uuid:=auth.uid();begin if not public.has_privileged_role_v1(array['super_admin','security']) then raise exception 'not authorized';end if;if role_value='super_admin' and not public.has_privileged_role_v1(array['super_admin']) then raise exception 'super admin role required';end if;if role_value not in('super_admin','trust_safety','content_moderator','verification','support','finance_ops','security','incident_commander') then raise exception 'invalid role';end if;if enabled then insert into public.privileged_role_assignments(profile_id,role_key,granted_by,reason) values(target_profile,role_value,actor,left(reason_value,1000)) on conflict(profile_id,role_key) where revoked_at is null do update set expires_at=null,reason=excluded.reason;else update public.privileged_role_assignments set revoked_at=now(),revoked_by=actor,reason=left(reason_value,1000) where profile_id=target_profile and role_key=role_value and revoked_at is null;end if;perform public.write_security_audit_v1(actor,case when enabled then 'privileged_role_granted' else 'privileged_role_revoked' end,'profile',target_profile::text,null,jsonb_build_object('role',role_value),reason_value,request_id_value,null,null);return true;end$$;

revoke all on function public.record_abuse_risk_signal_v1(uuid,uuid,text,integer,numeric,text,jsonb),public.record_linked_account_signal_v1(uuid,uuid,text,numeric,text,jsonb),public.claim_bulk_operation_items_v1(integer),public.complete_bulk_operation_item_v1(bigint,boolean,jsonb,text),public.run_moderation_sla_alerts_v1(),public.detect_security_anomalies_v1() from public,anon,authenticated;
grant execute on function public.record_abuse_risk_signal_v1(uuid,uuid,text,integer,numeric,text,jsonb),public.record_linked_account_signal_v1(uuid,uuid,text,numeric,text,jsonb),public.claim_bulk_operation_items_v1(integer),public.complete_bulk_operation_item_v1(bigint,boolean,jsonb,text),public.run_moderation_sla_alerts_v1(),public.detect_security_anomalies_v1() to service_role;
revoke all on function public.manage_security_alert_v1(uuid,text,text,text),public.set_feature_flag_v1(text,boolean,jsonb,text,text),public.set_system_notice_v1(uuid,text,text,text,text,timestamptz,timestamptz,boolean,text),public.manage_privileged_role_v1(uuid,text,boolean,text,text) from public,anon;
grant execute on function public.manage_security_alert_v1(uuid,text,text,text),public.set_feature_flag_v1(text,boolean,jsonb,text,text),public.set_system_notice_v1(uuid,text,text,text,text,timestamptz,timestamptz,boolean,text),public.manage_privileged_role_v1(uuid,text,boolean,text,text) to authenticated;
