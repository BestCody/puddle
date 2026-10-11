begin;
do $$
declare missing text; staff_function regprocedure;
begin
  select string_agg(name,', ') into missing from (values('privileged_role_assignments'),('moderation_cases'),('moderation_case_evidence'),('moderation_appeals'),('security_audit_events'),('security_events'),('security_alerts'),('rate_limit_rules'),('media_scan_jobs'),('bulk_operations')) expected(name) where to_regclass('public.'||name) is null;
  if missing is not null then raise exception 'Stage 9 tables missing: %',missing;end if;
  if position('aal2' in pg_get_functiondef('public.has_privileged_role_v1(text[])'::regprocedure))=0 then raise exception 'Privileged database functions do not require MFA';end if;
  if not exists(select 1 from pg_trigger where tgname='profiles_stage9_sensitive_guard' and tgenabled<>'D') then raise exception 'Sensitive profile field guard is missing';end if;
  if not exists(select 1 from pg_trigger where tgname='media_stage9_sensitive_guard' and tgenabled<>'D') then raise exception 'Media security field guard is missing';end if;
  if not exists(select 1 from pg_trigger where tgname='security_audit_immutable' and tgenabled<>'D') then raise exception 'Immutable security audit trigger is missing';end if;
  if not exists(select 1 from pg_trigger where tgname='audit_logs_immutable_stage9' and tgenabled<>'D') then raise exception 'Legacy audit log immutability is missing';end if;
  if has_function_privilege('anon','public.open_moderation_case_v1(text,text,text,text,text,text,text,text)','execute') then raise exception 'Anonymous users can open moderation cases';end if;
  if has_function_privilege('anon','public.admin_moderation_action_v1(uuid,text,jsonb,text)','execute') then raise exception 'Anonymous users can execute moderation actions';end if;
  if has_function_privilege('authenticated','public.admin_moderation_action_v1(uuid,text,jsonb,text)','execute') then raise exception 'Retired staff actions remain callable through PostgREST';end if;
  if has_function_privilege('authenticated','public.admin_remove_post_v1(uuid,text,text)','execute') then raise exception 'Retired post-removal RPC remains callable through PostgREST';end if;
  if has_function_privilege('authenticated','public.manage_privileged_role_v1(uuid,text,boolean,text,text)','execute') then raise exception 'Retired role-management RPC remains callable through PostgREST';end if;
  for staff_function in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'privileged_access_v1','preserve_case_evidence_v1','open_moderation_case_v1',
      'admin_moderation_action_v1','admin_remove_post_v1','queue_bulk_event_operation_v1',
      'admin_dashboard_v1','admin_content_review_queue_v1','admin_finance_queue_v1',
      'admin_security_dashboard_v1','manage_security_alert_v1','set_feature_flag_v1',
      'set_system_notice_v1','manage_privileged_role_v1'
    )
  loop
    if has_function_privilege('anon',staff_function,'execute') or has_function_privilege('authenticated',staff_function,'execute') then
      raise exception 'Retired staff RPC remains publicly callable: %',staff_function;
    end if;
    if not has_function_privilege('service_role',staff_function,'execute') then
      raise exception 'Service maintenance access was lost: %',staff_function;
    end if;
  end loop;
  if has_function_privilege('anon','public.dashboard_bootstrap_v1()','execute') or not has_function_privilege('authenticated','public.dashboard_bootstrap_v1()','execute') then raise exception 'Dashboard bootstrap privileges are incorrect';end if;
  if has_table_privilege('authenticated','public.feature_flags','update') then raise exception 'Authenticated users can bypass audited feature-flag changes';end if;
  if has_function_privilege('authenticated','public.consume_security_rate_limit_v1(uuid,text,text,text,uuid,integer,text)','execute') then raise exception 'Browser users can bypass server rate-limit context';end if;
  if has_function_privilege('authenticated','public.claim_media_scan_jobs_v1(integer)','execute') then raise exception 'Browser users can claim malware scan jobs';end if;
  if has_function_privilege('authenticated','public.claim_bulk_operation_items_v1(integer)','execute') then raise exception 'Browser users can claim bulk financial operations';end if;
  if not has_function_privilege('authenticated','public.report_social_target_v2(text,text,text,text,jsonb)','execute') then raise exception 'Authenticated users cannot submit reports';end if;
  if not has_function_privilege('authenticated','public.submit_moderation_appeal_v1(text,text,text)','execute') then raise exception 'Authenticated users cannot submit appeals';end if;
  if not has_function_privilege('anon','public.active_system_notices_v1()','execute') then raise exception 'Public system notices are unavailable';end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('moderation_cases','security_audit_events','rate_limit_counters','media_scan_jobs') and not c.relrowsecurity) then raise exception 'Stage 9 RLS is incomplete';end if;
end$$;
rollback;
