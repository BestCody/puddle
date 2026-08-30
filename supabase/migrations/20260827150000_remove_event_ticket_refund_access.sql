-- Event-ticket refunds are no longer a Puddle product capability.
-- Keep historical financial rows and migration history for auditability, but
-- remove every client and worker role's ability to invoke the retired flows.

revoke all on function public.request_order_refund_v1(uuid,integer,text)
  from public,anon,authenticated,service_role;

revoke all on function public.decide_refund_request_v1(uuid,text)
  from public,anon,authenticated,service_role;

revoke all on function public.apply_stripe_refund_update_v1(text,text,integer,text,text,text)
  from public,anon,authenticated,service_role;

revoke all on function public.queue_bulk_event_operation_v1(uuid,text,text,text)
  from public,anon,authenticated,service_role;

revoke all on table public.refund_requests from anon,authenticated;
