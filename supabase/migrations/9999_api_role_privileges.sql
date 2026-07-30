-- API privileges required in addition to row-level security policies.
-- RLS remains the authorization boundary for authenticated profile access.

grant usage on schema public to authenticated, service_role;

grant select, insert, update on table public.profiles to authenticated;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;
