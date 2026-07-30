-- Stage 9D: row-level security and strict execution grants.
alter table public.privileged_role_assignments enable row level security;
alter table public.moderation_sla_policies enable row level security;
alter table public.moderation_cases enable row level security;
alter table public.moderation_case_evidence enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.moderation_appeals enable row level security;
alter table public.abuse_risk_signals enable row level security;
alter table public.linked_account_signals enable row level security;
alter table public.security_events enable row level security;
alter table public.security_alerts enable row level security;
alter table public.system_notices enable row level security;
alter table public.security_audit_events enable row level security;
alter table public.rate_limit_rules enable row level security;
alter table public.rate_limit_counters enable row level security;
alter table public.media_scan_jobs enable row level security;
alter table public.bulk_operations enable row level security;
alter table public.bulk_operation_items enable row level security;

create policy "privileged users read role assignments" on public.privileged_role_assignments for select using(profile_id=auth.uid() or public.has_privileged_role_v1(array['super_admin','security']));
create policy "privileged users read sla policies" on public.moderation_sla_policies for select using(public.has_privileged_role_v1(array['super_admin','trust_safety','content_moderator','security']));
create policy "privileged users read moderation cases" on public.moderation_cases for select using(public.has_privileged_role_v1(array['super_admin','trust_safety','content_moderator','verification','support','finance_ops','security','incident_commander']) or reporter_id=auth.uid() or subject_id=auth.uid()::text);
create policy "privileged users read evidence" on public.moderation_case_evidence for select using(public.has_privileged_role_v1(array['super_admin','trust_safety','content_moderator','verification','support','finance_ops','security','incident_commander']));
create policy "privileged users read moderation actions" on public.moderation_actions for select using(public.has_privileged_role_v1(array['super_admin','trust_safety','content_moderator','verification','support','finance_ops','security','incident_commander']));
create policy "appeal participants read appeals" on public.moderation_appeals for select using(appellant_id=auth.uid() or public.has_privileged_role_v1(array['super_admin','trust_safety','support','security']));
create policy "privileged users read risk signals" on public.abuse_risk_signals for select using(public.has_privileged_role_v1(array['super_admin','trust_safety','security']));
create policy "security reads linked signals" on public.linked_account_signals for select using(public.has_privileged_role_v1(array['super_admin','security','trust_safety']));
create policy "privileged users read security events" on public.security_events for select using(public.has_privileged_role_v1(array['super_admin','security','trust_safety']));
create policy "privileged users read security alerts" on public.security_alerts for select using(public.has_privileged_role_v1(array['super_admin','security','incident_commander']));
create policy "privileged users read notices" on public.system_notices for select using(public.has_privileged_role_v1(array['super_admin','support','incident_commander']));
create policy "security reads immutable audit" on public.security_audit_events for select using(public.has_privileged_role_v1(array['super_admin','security']));
create policy "security reads rate rules" on public.rate_limit_rules for select using(public.has_privileged_role_v1(array['super_admin','security']));
create policy "security reads rate counters" on public.rate_limit_counters for select using(public.has_privileged_role_v1(array['super_admin','security']));
create policy "upload owners read scan state" on public.media_scan_jobs for select using(exists(select 1 from public.media_assets a where a.id=media_asset_id and (a.owner_id=auth.uid() or public.has_privileged_role_v1(array['super_admin','security','verification','content_moderator']))));
create policy "privileged users read bulk operations" on public.bulk_operations for select using(public.has_privileged_role_v1(array['super_admin','finance_ops','incident_commander']));
create policy "privileged users read bulk items" on public.bulk_operation_items for select using(public.has_privileged_role_v1(array['super_admin','finance_ops','incident_commander']));
create policy "privileged profile review" on public.profiles for select using(id=auth.uid() or public.has_privileged_role_v1(array['super_admin','trust_safety','content_moderator','verification','support','finance_ops','security','incident_commander']));

revoke all on function public.consume_security_rate_limit_v1(uuid,text,text,text,uuid,integer,text),public.record_security_event_v1(uuid,text,text,text,text,text,text,text,text,jsonb),public.claim_media_scan_jobs_v1(integer),public.complete_media_scan_job_v1(bigint,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.consume_security_rate_limit_v1(uuid,text,text,text,uuid,integer,text),public.record_security_event_v1(uuid,text,text,text,text,text,text,text,text,jsonb),public.claim_media_scan_jobs_v1(integer),public.complete_media_scan_job_v1(bigint,text,text,jsonb) to service_role;

revoke all on function public.privileged_roles_v1(uuid),public.privileged_access_v1(text[]),public.has_privileged_role_v1(text[]),public.report_social_target_v2(text,text,text,text,jsonb),public.preserve_case_evidence_v1(uuid,text,text),public.open_moderation_case_v1(text,text,text,text,text,text,text,text),public.admin_moderation_action_v1(uuid,text,jsonb,text),public.queue_bulk_event_operation_v1(uuid,text,text,text),public.submit_moderation_appeal_v1(text,text,text),public.can_access_private_media_v1(uuid),public.queue_media_scan_job_v1(uuid),public.admin_dashboard_v1(),public.admin_content_review_queue_v1(),public.admin_finance_queue_v1(),public.admin_security_dashboard_v1() from public,anon;
grant execute on function public.privileged_roles_v1(uuid),public.privileged_access_v1(text[]),public.has_privileged_role_v1(text[]),public.report_social_target_v2(text,text,text,text,jsonb),public.preserve_case_evidence_v1(uuid,text,text),public.open_moderation_case_v1(text,text,text,text,text,text,text,text),public.admin_moderation_action_v1(uuid,text,jsonb,text),public.queue_bulk_event_operation_v1(uuid,text,text,text),public.submit_moderation_appeal_v1(text,text,text),public.can_access_private_media_v1(uuid),public.queue_media_scan_job_v1(uuid),public.admin_dashboard_v1(),public.admin_content_review_queue_v1(),public.admin_finance_queue_v1(),public.admin_security_dashboard_v1() to authenticated;
revoke all on function public.active_system_notices_v1() from public;
grant execute on function public.active_system_notices_v1() to anon,authenticated;

revoke insert,update,delete on public.security_audit_events,public.security_events,public.security_alerts,public.rate_limit_rules,public.rate_limit_counters,public.media_scan_jobs,public.moderation_case_evidence,public.moderation_actions,public.bulk_operations,public.bulk_operation_items from anon,authenticated;
grant select on public.privileged_role_assignments,public.moderation_sla_policies,public.moderation_cases,public.moderation_case_evidence,public.moderation_actions,public.moderation_appeals,public.abuse_risk_signals,public.linked_account_signals,public.security_events,public.security_alerts,public.system_notices,public.security_audit_events,public.rate_limit_rules,public.rate_limit_counters,public.media_scan_jobs,public.bulk_operations,public.bulk_operation_items to authenticated;
grant usage,select on sequence public.moderation_case_number_seq,public.moderation_actions_id_seq,public.abuse_risk_signals_id_seq,public.linked_account_signals_id_seq,public.security_events_id_seq,public.security_audit_events_id_seq,public.media_scan_jobs_id_seq,public.bulk_operation_items_id_seq to service_role;
