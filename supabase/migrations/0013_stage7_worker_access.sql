-- Stage 7 trusted-worker access. Apply after 0012_temporary_location_sharing.sql.
revoke execute on function public.expire_location_shares_v1(integer) from public,anon,authenticated;
grant execute on function public.expire_location_shares_v1(integer) to service_role;
