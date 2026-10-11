-- The product shell no longer exposes the staff dashboard. Keep the shared
-- bootstrap limited to the notification and pass data it actually renders.
create or replace function public.dashboard_bootstrap_v1()
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_unread bigint := 0;
  v_pass boolean := false;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select count(*)
    into v_unread
  from public.notifications
  where profile_id = v_uid
    and read_at is null;

  v_pass := coalesce(public.puddle_tinder_active_v1(), false);

  return jsonb_build_object(
    'unread_notifications', v_unread,
    'pass_active', v_pass
  );
end;
$$;

revoke execute on function public.dashboard_bootstrap_v1() from public, anon;
grant execute on function public.dashboard_bootstrap_v1() to authenticated, service_role;

-- Keep the moderation records and service-role maintenance functions, but
-- stop exposing staff-only RPCs through authenticated PostgREST sessions.
-- Restored databases can inherit PUBLIC's default EXECUTE permission, so
-- revoking authenticated alone would not actually close these endpoints.
revoke execute on function
  public.privileged_access_v1(text[]),
  public.preserve_case_evidence_v1(uuid,text,text),
  public.open_moderation_case_v1(text,text,text,text,text,text,text,text),
  public.admin_moderation_action_v1(uuid,text,jsonb,text),
  public.admin_remove_post_v1(uuid,text,text),
  public.queue_bulk_event_operation_v1(uuid,text,text,text),
  public.admin_dashboard_v1(),
  public.admin_content_review_queue_v1(),
  public.admin_finance_queue_v1(),
  public.admin_security_dashboard_v1(),
  public.manage_security_alert_v1(uuid,text,text,text),
  public.set_feature_flag_v1(text,boolean,jsonb,text,text),
  public.set_system_notice_v1(uuid,text,text,text,text,timestamptz,timestamptz,boolean,text),
  public.manage_privileged_role_v1(uuid,text,boolean,text,text)
from public, anon, authenticated;

grant execute on function
  public.privileged_access_v1(text[]),
  public.preserve_case_evidence_v1(uuid,text,text),
  public.open_moderation_case_v1(text,text,text,text,text,text,text,text),
  public.admin_moderation_action_v1(uuid,text,jsonb,text),
  public.admin_remove_post_v1(uuid,text,text),
  public.queue_bulk_event_operation_v1(uuid,text,text,text),
  public.admin_dashboard_v1(),
  public.admin_content_review_queue_v1(),
  public.admin_finance_queue_v1(),
  public.admin_security_dashboard_v1(),
  public.manage_security_alert_v1(uuid,text,text,text),
  public.set_feature_flag_v1(text,boolean,jsonb,text,text),
  public.set_system_notice_v1(uuid,text,text,text,text,timestamptz,timestamptz,boolean,text),
  public.manage_privileged_role_v1(uuid,text,boolean,text,text)
to service_role;
