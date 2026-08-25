-- RLS policies decide which notification rows a user may access, while
-- PostgREST still requires table privileges for the authenticated role.
grant select, update on table public.notifications to authenticated;
grant select, insert, update on table public.notification_preferences to authenticated;
