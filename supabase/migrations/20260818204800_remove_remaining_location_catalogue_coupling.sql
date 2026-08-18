begin;

-- Sparse mutable state for global locations. This table is not catalogue storage:
-- rows exist only for explicitly moderated locations and contain no place metadata.
create table if not exists public.location_moderation_overrides (
  location_id uuid primary key references public.location_refs(id) on delete cascade,
  state text not null default 'active' check (state in ('active','suspended')),
  reason text,
  moderated_by uuid references public.profiles(id) on delete set null,
  moderated_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.location_moderation_overrides enable row level security;
revoke all on table public.location_moderation_overrides from anon,authenticated;
grant select on table public.location_moderation_overrides to anon,authenticated;
grant all on table public.location_moderation_overrides to service_role;
drop policy if exists "public location moderation state" on public.location_moderation_overrides;
create policy "public location moderation state" on public.location_moderation_overrides
for select to anon,authenticated using (true);

-- Authored submissions and claimed global locations are both manageable without
-- copying catalogue fields into Postgres.
create or replace function public.can_manage_location(target uuid)
returns boolean language sql stable security definer set search_path='public' as $$
  select public.is_admin()
    or exists(
      select 1 from public.location_submissions s where s.id=target and (
        s.created_by=(select auth.uid())
        or (s.host_profile_id is not null and public.has_host_role(s.host_profile_id,array['owner','editor']))
      )
    )
    or exists(
      select 1 from public.location_host_links link
      where link.location_id=target and public.has_host_role(link.host_profile_id,array['owner','editor'])
    )
$$;
revoke all on function public.can_manage_location(uuid) from public,anon;
grant execute on function public.can_manage_location(uuid) to authenticated,service_role;

-- Shared trigger helpers keep their non-location behavior and treat authored
-- location drafts as the only location records stored in Supabase.
create or replace function public.assert_media_pointer()
returns trigger language plpgsql security definer set search_path='public' as $$
declare expected_purpose text;expected_type text;expected_target uuid;object_value text;
begin
  if tg_table_name='profiles' then expected_purpose:='profile_photo';expected_type:='profile';expected_target:=new.id;object_value:=new.avatar_path;
  elsif tg_table_name='host_profiles' then expected_purpose:='host_logo';expected_type:='host';expected_target:=new.id;object_value:=new.logo_path;
  elsif tg_table_name='events' then expected_purpose:='event_cover';expected_type:='event';expected_target:=new.id;object_value:=new.cover_path;
  elsif tg_table_name='location_submissions' then expected_purpose:='location_cover';expected_type:='location';expected_target:=new.id;object_value:=new.cover_path;
  else raise exception 'unsupported media pointer table'; end if;
  if object_value is not null and not exists(
    select 1 from public.media_assets m where m.object_path=object_value and m.target_type=expected_type and m.target_id=expected_target
      and m.purpose=expected_purpose and m.visibility='public' and m.status='approved' and m.scan_status='clean'
  ) then raise exception 'media pointer is not an approved asset for this record'; end if;
  return new;
end
$$;

create or replace function public.protect_stage9_sensitive_fields_v1()
returns trigger language plpgsql security definer set search_path='public' as $$
declare privileged boolean:=coalesce(auth.role(),'')='service_role' or public.has_privileged_role_v1(array['super_admin','trust_safety','content_moderator','verification','security','incident_commander','finance_ops']);
begin
  if tg_table_name='profiles' then
    if new.role is distinct from old.role or new.account_kind is distinct from old.account_kind or new.age_verified_at is distinct from old.age_verified_at or new.suspended_at is distinct from old.suspended_at or new.banned_at is distinct from old.banned_at or new.ban_reason is distinct from old.ban_reason or new.moderation_state is distinct from old.moderation_state or new.risk_score is distinct from old.risk_score then if not privileged then raise exception 'privileged profile fields cannot be changed';end if;end if;
  elsif tg_table_name='host_profiles' then
    if new.payout_frozen_at is distinct from old.payout_frozen_at or new.payout_freeze_reason is distinct from old.payout_freeze_reason or new.delisted_at is distinct from old.delisted_at or new.moderation_state is distinct from old.moderation_state or new.created_by is distinct from old.created_by or ((old.status='suspended' or new.status='suspended') and new.status is distinct from old.status) then if not privileged then raise exception 'privileged host fields cannot be changed';end if;end if;
    if new.verification_status is distinct from old.verification_status and not privileged then if not (new.verification_status='pending' and old.verification_status in('unverified','rejected') and public.has_host_role(new.id,array['owner'])) then raise exception 'verification status cannot be changed';end if;end if;
  elsif tg_table_name='events' then
    if new.delisted_at is distinct from old.delisted_at or new.moderation_hold_at is distinct from old.moderation_hold_at or new.moderation_reason is distinct from old.moderation_reason then if not privileged then raise exception 'event moderation fields cannot be changed';end if;end if;
  elsif tg_table_name='location_submissions' then
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
end
$$;

-- Admin review surfaces use submission workflow state plus sparse global
-- moderation overrides; they never enumerate the OpenSearch catalogue.
create or replace function public.admin_content_review_queue_v1()
returns jsonb language plpgsql stable security definer set search_path='public' as $$
begin
  if not public.has_privileged_role_v1(array['super_admin','trust_safety','content_moderator','verification']) then raise exception 'not authorized';end if;
  return jsonb_build_object(
    'content',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(
      select 'event' subject_type,id::text subject_id,title,coalesce(moderation_reason,status::text) reason from public.events where status in('pending_review','suspended') or moderation_hold_at is not null
      union all
      select 'location',id::text,name,coalesce(moderation_reason,status) from public.location_submissions where status in('pending_review','suspended') or moderation_hold_at is not null
      limit 100
    )x),
    'verification',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(
      select 'location_claim' subject_type,id::text subject_id,'Location claim' title,status state from public.location_claims where status in('pending','under_review')
      union all select 'host',id::text,name,verification_status from public.host_profiles where verification_status='pending'
      union all select 'verification_document',id::text,document_kind,review_status from public.verification_documents where review_status='pending_review'
      limit 100
    )x),
    'media',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(
      select id,original_name,scan_status,status,created_at from public.media_assets where scan_status in('pending','suspicious','infected','error') order by created_at limit 100
    )x)
  );
end
$$;

-- Keep the full moderation action contract. Location moderation writes only a
-- sparse override, and approved claims use location_host_links.
create or replace function public.admin_moderation_action_v1(target_case uuid,action_name text,action_payload jsonb,request_id_value text)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare actor uuid:=auth.uid();item public.moderation_cases%rowtype;before_value jsonb;after_value jsonb;reason_value text:=left(coalesce(action_payload->>'reason',''),2000);priority_value text:=coalesce(action_payload->>'priority','normal');subject_uuid uuid;appeal_id uuid;
begin
  if not public.has_privileged_role_v1(array['super_admin','trust_safety','content_moderator','verification','support','finance_ops','security','incident_commander']) then raise exception 'not authorized';end if;
  select * into item from public.moderation_cases where id=target_case for update;if item.id is null then raise exception 'case unavailable';end if;before_value:=to_jsonb(item);begin subject_uuid:=item.subject_id::uuid;exception when invalid_text_representation then subject_uuid:=null;end;
  if action_name in('suspend_user','ban_user','restore_user','delist_event','cancel_event','relist_event','delist_location','relist_location','remove_message','remove_comment','restrict_conversation','reopen_conversation','suspend_host','restore_host') and not public.has_privileged_role_v1(array['super_admin','trust_safety','content_moderator']) then raise exception 'trust and safety role required';end if;
  if action_name in('approve_host_verification','reject_host_verification','approve_verification_document','reject_verification_document','approve_location_claim','reject_location_claim','quarantine_media','approve_media') and not public.has_privileged_role_v1(array['super_admin','trust_safety','verification']) then raise exception 'verification role required';end if;
  if action_name in('freeze_payouts','unfreeze_payouts','fraud_hold_order','release_fraud_hold','void_ticket','restore_ticket','approve_refund','decline_refund') and not public.has_privileged_role_v1(array['super_admin','finance_ops','incident_commander']) then raise exception 'finance role required';end if;
  if action_name in('uphold_appeal','overturn_appeal') and not public.has_privileged_role_v1(array['super_admin','trust_safety','support']) then raise exception 'appeals role required';end if;
  if char_length(reason_value)<8 and action_name not in('assign_self','preserve_evidence','set_priority') then raise exception 'a specific reason is required';end if;

  if action_name='assign_self' then update public.moderation_cases set assigned_to=actor,assigned_at=now(),state=case when state='open' then 'triaged' else state end where id=item.id;
  elsif action_name='set_priority' then if priority_value not in('low','normal','high','urgent','emergency') then raise exception 'invalid priority';end if;update public.moderation_cases set priority=priority_value where id=item.id;
  elsif action_name='preserve_evidence' then perform public.preserve_case_evidence_v1(item.id,item.subject_type,item.subject_id);
  elsif action_name in('resolve','dismiss') then update public.moderation_cases set state=case when action_name='resolve' then 'resolved' else 'dismissed' end,resolution_code=action_name,resolution_note=reason_value,resolved_at=now() where id=item.id;
  elsif action_name='escalate_emergency' then update public.moderation_cases set priority='emergency',emergency_escalated_at=now(),queue_key='emergency' where id=item.id;insert into public.security_alerts(title,severity,metadata) values('Emergency moderation escalation','critical',jsonb_build_object('case_id',item.id,'subject_type',item.subject_type,'subject_id',item.subject_id));
  elsif action_name='suspend_user' and item.subject_type='profile' then update public.profiles set suspended_at=coalesce(suspended_at,now()),moderation_state='suspended',ban_reason=reason_value where id=subject_uuid;
  elsif action_name='ban_user' and item.subject_type='profile' then update public.profiles set banned_at=coalesce(banned_at,now()),suspended_at=coalesce(suspended_at,now()),moderation_state='banned',ban_reason=reason_value where id=subject_uuid;
  elsif action_name='restore_user' and item.subject_type='profile' then update public.profiles set banned_at=null,suspended_at=null,moderation_state='active',ban_reason=null where id=subject_uuid;
  elsif action_name in('delist_event','cancel_event','relist_event') and item.subject_type='event' then perform set_config('puddle.allow_status_transition','on',true);update public.events set delisted_at=case when action_name='relist_event' then null else now() end,moderation_hold_at=case when action_name='relist_event' then null else now() end,moderation_reason=case when action_name='relist_event' then null else reason_value end,status=case when action_name='cancel_event' then 'cancelled'::public.event_status when action_name='relist_event' then 'published'::public.event_status else status end where id=subject_uuid;
  elsif action_name in('delist_location','relist_location') and item.subject_type='location' then
    if not exists(select 1 from public.location_refs where id=subject_uuid) then raise exception 'location unavailable';end if;
    insert into public.location_moderation_overrides(location_id,state,reason,moderated_by,moderated_at,updated_at)
    values(subject_uuid,case when action_name='relist_location' then 'active' else 'suspended' end,case when action_name='relist_location' then null else reason_value end,actor,now(),now())
    on conflict(location_id) do update set state=excluded.state,reason=excluded.reason,moderated_by=excluded.moderated_by,moderated_at=excluded.moderated_at,updated_at=excluded.updated_at;
  elsif action_name in('suspend_host','restore_host') and item.subject_type='host' then update public.host_profiles set status=case when action_name='restore_host' then 'active' else 'suspended' end,moderation_state=case when action_name='restore_host' then 'active' else 'suspended' end,delisted_at=case when action_name='restore_host' then null else now() end where id=subject_uuid;
  elsif action_name in('freeze_payouts','unfreeze_payouts') and item.subject_type='host' then update public.host_profiles set payout_frozen_at=case when action_name='freeze_payouts' then now() else null end,payout_freeze_reason=case when action_name='freeze_payouts' then reason_value else null end where id=subject_uuid;
  elsif action_name in('restrict_conversation','reopen_conversation') and item.subject_type='conversation' then update public.conversations set moderation_state=case when action_name='reopen_conversation' then 'active' else 'restricted' end,moderated_at=now(),moderated_by=actor,moderation_reason=case when action_name='reopen_conversation' then null else reason_value end where id=subject_uuid;
  elsif action_name='remove_message' and item.subject_type='message' then update public.messages set state='moderator_removed',body='Message removed by moderation',moderator_removed_at=now(),moderator_removed_by=actor,moderator_reason=reason_value,metadata='{}' where id=item.subject_id::bigint;
  elsif action_name='remove_comment' and item.subject_type='comment' then update public.social_comments set deleted_at=coalesce(deleted_at,now()),body='Comment removed by moderation',moderator_removed_at=now(),moderator_removed_by=actor,moderator_reason=reason_value where id=item.subject_id::bigint;
  elsif action_name in('approve_host_verification','reject_host_verification') and item.subject_type='host' then update public.host_profiles set verification_status=case when action_name='approve_host_verification' then 'verified' else 'rejected' end,moderation_state=case when action_name='approve_host_verification' then 'active' else moderation_state end where id=subject_uuid;
  elsif action_name in('approve_verification_document','reject_verification_document') and item.subject_type='verification_document' then update public.verification_documents set review_status=case when action_name='approve_verification_document' then 'verified' else 'rejected' end,reviewed_by=actor,reviewed_at=now() where id=subject_uuid and review_status='pending_review';
  elsif action_name='approve_location_claim' and item.subject_type='location_claim' then perform public.approve_location_claim(subject_uuid,reason_value);
  elsif action_name='reject_location_claim' and item.subject_type='location_claim' then update public.location_claims set status='rejected',reviewed_by=actor,reviewed_at=now(),review_note=reason_value where id=subject_uuid;
  elsif action_name in('quarantine_media','approve_media') and item.subject_type='media' then if action_name='approve_media' and not exists(select 1 from public.media_assets where id=subject_uuid and scan_status='clean') then raise exception 'media scan is not clean';end if;update public.media_assets set status=case when action_name='quarantine_media' then 'quarantined' else 'approved' end,evidence_hold_at=case when action_name='quarantine_media' then now() else evidence_hold_at end where id=subject_uuid;
  elsif action_name in('fraud_hold_order','release_fraud_hold') and item.subject_type in('order','payment') then update public.orders set status=case when action_name='fraud_hold_order' then 'fraud_hold' else case when paid_at is not null then 'paid' else 'pending' end end,fraud_hold_reason=case when action_name='fraud_hold_order' then reason_value else null end where id=subject_uuid;
  elsif action_name in('void_ticket','restore_ticket') and item.subject_type='ticket' then update public.tickets set status=case when action_name='void_ticket' then 'void' else 'valid' end,token_version=token_version+1,signed_token=null,signed_at=null,void_reason=case when action_name='void_ticket' then reason_value else null end,updated_at=now() where id=subject_uuid and (action_name='void_ticket' or exists(select 1 from public.orders o where o.id=public.tickets.order_id and o.status='paid'));
  elsif action_name in('approve_refund','decline_refund') and item.subject_type='refund' then update public.refund_requests set status=case when action_name='approve_refund' then 'approved' else 'declined' end,decided_by=actor,decided_at=now(),decision_note=reason_value,updated_at=now() where id=subject_uuid and status='requested';
  elsif action_name in('uphold_appeal','overturn_appeal') then select id into appeal_id from public.moderation_appeals where case_id=item.id and state in('submitted','assigned','reviewing') order by created_at desc limit 1 for update;if appeal_id is null then raise exception 'open appeal unavailable';end if;update public.moderation_appeals set state=case when action_name='overturn_appeal' then 'overturned' else 'upheld' end,decision_reason=reason_value,decided_by=actor,decided_at=now() where id=appeal_id;update public.moderation_cases set state='resolved',resolution_code=action_name,resolution_note=reason_value,resolved_at=now() where id=item.id;
  else raise exception 'action is not valid for this case';end if;
  select to_jsonb(c) into after_value from public.moderation_cases c where c.id=item.id;
  insert into public.moderation_actions(case_id,actor_id,action,reason,before_data,after_data,request_id) values(item.id,actor,action_name,reason_value,before_value,after_value,left(request_id_value,120));
  perform public.write_security_audit_v1(actor,action_name,item.subject_type,item.subject_id,before_value,after_value,reason_value,request_id_value,null,null);
  return jsonb_build_object('ok',true,'case_id',item.id,'action',action_name);
end
$$;

create or replace function public.preserve_case_evidence_v1(target_case uuid,source_type_value text,source_id_value text)
returns uuid language plpgsql security definer set search_path='public' as $$
declare snapshot_value jsonb;created uuid;asset uuid;hash_value text;
begin
  if not public.has_privileged_role_v1(array['super_admin','trust_safety','content_moderator','security','support','finance_ops','verification']) and not exists(select 1 from public.moderation_cases where id=target_case and created_by=auth.uid()) then raise exception 'not authorized';end if;
  if source_type_value='media' then begin asset:=source_id_value::uuid;exception when invalid_text_representation then asset:=null;end;end if;
  snapshot_value:=case source_type_value
    when 'message' then (select to_jsonb(m) from public.messages m where m.id::text=source_id_value)
    when 'comment' then (select to_jsonb(c) from public.social_comments c where c.id::text=source_id_value)
    when 'conversation' then (select to_jsonb(c) from public.conversations c where c.id::text=source_id_value)
    when 'event' then (select to_jsonb(e) from public.events e where e.id::text=source_id_value)
    when 'location' then (select jsonb_build_object('reference',to_jsonb(r),'moderation',to_jsonb(o),'hostLink',to_jsonb(h)) from public.location_refs r left join public.location_moderation_overrides o on o.location_id=r.id left join public.location_host_links h on h.location_id=r.id where r.id::text=source_id_value)
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
end
$$;

-- AI assistance for a place draft/claimed place reads only ownership overlays.
create or replace function public.reserve_ai_assistance_v1(target_kind text,target_id uuid,request_purpose text,source_data jsonb,prompt_text text,provider_name text,model_name text,model_revision text,prompt_revision text)
returns uuid language plpgsql security definer set search_path='public' as $$
declare actor uuid:=auth.uid();run_id uuid;host_id uuid;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if not public.feature_enabled_v1('ai_creation_enabled') then raise exception 'AI creation is disabled'; end if;
  if provider_name<>'rules' then
    if request_purpose='social_caption' and not public.feature_enabled_v1('ai_social_caption_enabled') then raise exception 'AI social captions are disabled'; end if;
    if request_purpose<>'social_caption' and not public.feature_enabled_v1('ai_writing_enabled') then raise exception 'AI writing is disabled'; end if;
  end if;
  if target_kind not in ('event','location') then raise exception 'invalid content kind'; end if;
  if request_purpose not in ('title','short_description','description','categories_tags','accessibility_prompts','social_caption','missing_information') then raise exception 'invalid assistance purpose'; end if;
  if jsonb_typeof(source_data)<>'object' or octet_length(source_data::text)>24000 then raise exception 'source fields are invalid'; end if;
  if target_id is not null and not public.can_manage_ai_content(target_kind,target_id) then raise exception 'not authorized for this draft'; end if;
  if (select count(*) from public.ai_assistance_runs where profile_id=actor and created_at>now()-interval '1 hour')>=20 then raise exception 'hourly AI assistance limit reached'; end if;
  if (select count(*) from public.ai_assistance_runs where profile_id=actor and created_at>now()-interval '1 day')>=100 then raise exception 'daily AI assistance limit reached'; end if;
  if target_id is not null then
    if target_kind='event' then select host_profile_id into host_id from public.events where id=target_id;
    else select coalesce(s.host_profile_id,link.host_profile_id) into host_id from public.location_refs r left join public.location_submissions s on s.id=r.id left join public.location_host_links link on link.location_id=r.id where r.id=target_id; end if;
  end if;
  if host_id is not null and (select count(*) from public.ai_assistance_runs where host_profile_id=host_id and created_at>now()-interval '1 hour')>=60 then raise exception 'host hourly AI assistance limit reached'; end if;
  if host_id is not null and (select count(*) from public.ai_assistance_runs where host_profile_id=host_id and created_at>now()-interval '1 day')>=300 then raise exception 'host daily AI assistance limit reached'; end if;
  insert into public.ai_assistance_runs(profile_id,host_profile_id,content_kind,content_id,purpose,source_fields,source_hash,sanitized_prompt,provider,model,model_version,prompt_version)
  values(actor,host_id,target_kind,target_id,request_purpose,source_data,md5(source_data::text),left(prompt_text,16000),provider_name,left(model_name,160),left(model_revision,160),left(prompt_revision,80))
  returning id into run_id;
  return run_id;
end
$$;

-- Social RPCs return relationship data and location IDs only. Vercel hydrates
-- all place metadata from OpenSearch.
create or replace function public.shared_places_with_friend_v1(target_friend uuid)
returns table(location_id uuid,name text,slug text,city text,cover_path text,category text)
language plpgsql stable security definer set search_path='public' as $$
begin
  if not public.profiles_are_friends(auth.uid(),target_friend) then raise exception 'Friend unavailable.'; end if;
  return query
  select distinct mine.location_id,null::text,null::text,null::text,null::text,null::text
  from public.user_content_states mine
  join public.user_content_states theirs on theirs.profile_id=target_friend and theirs.location_id=mine.location_id and theirs.state in ('saved','interested')
  where mine.profile_id=auth.uid() and mine.state in ('saved','interested') and mine.location_id is not null
  order by mine.location_id;
end
$$;

create or replace function public.social_shared_locations_v1()
returns table(share_id bigint,friend_id uuid,friend_name text,friend_username text,friend_avatar_path text,direction text,note text,created_at timestamptz,location_id uuid,location_name text,location_city text,location_slug text,location_cover_path text)
language sql stable security definer set search_path='public' as $$
  select s.id,p.id,p.display_name,p.username,p.avatar_path,
    case when s.sender_id=auth.uid() then 'sent' else 'received' end,
    s.note,s.created_at,s.location_id,null::text,null::text,null::text,null::text
  from public.content_shares s
  join public.profiles p on p.id=case when s.sender_id=auth.uid() then s.recipient_id else s.sender_id end
  where s.location_id is not null and (s.sender_id=auth.uid() or s.recipient_id=auth.uid())
    and public.profiles_are_friends(auth.uid(),p.id)
  order by s.created_at desc
  limit 200
$$;

-- Retire the old Postgres catalogue/search/recommendation workers using the
-- exact signatures installed in production. OpenSearch owns location serving.
drop function if exists public.catalogue_quality_review_v1(integer) cascade;
drop function if exists public.claim_google_place_candidates_v3(integer) cascade;
drop function if exists public.claim_google_place_discovery_candidates_v1(integer) cascade;
drop function if exists public.claim_google_place_geocode_candidates_v1(integer) cascade;
drop function if exists public.claim_open_photo_candidates_v1(integer,uuid) cascade;
drop function if exists public.complete_open_photo_candidate_v1(uuid,text,text) cascade;
drop function if exists public.content_in_view_v1(double precision,double precision,double precision,double precision,integer) cascade;
drop function if exists public.discover_candidates_v1(double precision,double precision,integer,integer) cascade;
drop function if exists public.discovery_spatial_profile_v1(interval) cascade;
drop function if exists public.finalize_catalogue_region_refresh_v1(uuid,text) cascade;
drop function if exists public.find_open_location_match_v1(text,text,double precision,double precision,text) cascade;
drop function if exists public.find_open_location_match_v2(text,text,double precision,double precision,text,text,text) cascade;
drop function if exists public.r2_discovery_overlay_v2(double precision,double precision,integer,integer,uuid[],text,integer,text,text,boolean,boolean) cascade;
drop function if exists public.upsert_open_catalogue_location_v1(text,jsonb) cascade;

-- The previous recommendation candidate/vector-place system is no longer on the
-- request path. Keep user preference settings/tables, remove the catalogue-bound RPCs.
drop function if exists public.recommendation_candidate_pool_v1(double precision,double precision,integer,integer) cascade;
drop function if exists public.recommendation_context_base_v1() cascade;
drop function if exists public.recommendation_preference_text_base_v1(uuid) cascade;
drop function if exists public.recommendation_preference_text_v1(uuid) cascade;
drop function if exists public.record_recommendation_outcome_v1(uuid,text,uuid,text,jsonb) cascade;
drop function if exists public.sync_recommendation_context_event_v1() cascade;
drop function if exists public.claim_embedding_jobs_v1(integer) cascade;
drop function if exists public.queue_embedding_regeneration_v1(text) cascade;

-- Old venue-presence live-location sharing depended on relational catalogue
-- coordinates and has no current product API. Precise/approximate profile location
-- state is separate and remains untouched.
drop function if exists public.update_location_point_v1(uuid,double precision,double precision,double precision) cascade;

-- Remove stale place embeddings/jobs; event/user embeddings and preference rows remain.
delete from public.embedding_jobs where content_kind='place';
delete from public.content_embeddings where content_kind='place';

commit;
