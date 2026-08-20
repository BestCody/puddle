-- Harden helper and trigger functions surfaced by the Supabase database linter.
--
-- Keep historical migrations immutable. This forward-only migration fixes two
-- classes of security drift without changing application behavior:
--   1. helper functions now have a deterministic search_path; and
--   2. trigger-only SECURITY DEFINER functions are no longer callable as RPCs.

-- These helpers were reported with a role-mutable search_path. They either use
-- built-ins only or public-schema objects, so pinning public before pg_temp keeps
-- their current name resolution while preventing caller-controlled search-path
-- changes.
alter function public.protect_security_audit_v1()
  set search_path = public, pg_temp;
alter function public.protect_legacy_audit_v1()
  set search_path = public, pg_temp;
alter function public.context_event_weight_v1(text)
  set search_path = public, pg_temp;
alter function public.contextual_key_token_v1(text)
  set search_path = public, pg_temp;
alter function public.contextual_intent_bucket_v1(jsonb)
  set search_path = public, pg_temp;
alter function public.discovery_location_group_key_v1(text, text, text, double precision, double precision)
  set search_path = public, pg_temp;
alter function public.discovery_clock_minutes_v1(text)
  set search_path = public, pg_temp;
alter function public.discovery_is_open_now_v1(jsonb, text, timestamptz)
  set search_path = public, pg_temp;

-- The functions below are attached to database triggers and are not public API
-- endpoints. PostgreSQL checks trigger-function privileges when the trigger is
-- created, so removing PostgREST-facing EXECUTE grants does not disable the
-- already-created triggers.
revoke execute on function public.add_host_owner() from public, anon, authenticated;
revoke execute on function public.capture_event_revision() from public, anon, authenticated;
revoke execute on function public.capture_location_revision() from public, anon, authenticated;
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.revoke_location_sharing_on_block() from public, anon, authenticated;
revoke execute on function public.sync_event_occurrences() from public, anon, authenticated;
revoke execute on function public.sync_event_private_address_flag() from public, anon, authenticated;
