begin;

-- Retire the separate Global likes system, not Pass billing or friend messaging.
-- Explicit drops deliberately fail if an unexpected dependency exists.
drop function if exists public.global_like_matches_v1(integer);
drop function if exists public.request_global_connection_v1(uuid,uuid,text,text);
drop function if exists public.respond_global_connection_v1(uuid,text);
drop function if exists public.send_global_connection_message_v1(uuid,text);
drop function if exists public.global_connection_snapshot_v1();
drop function if exists public.block_global_connection_v1(uuid);
drop function if exists public.report_global_connection_v1(uuid,uuid,text,text);

-- Drop dependent tables before threads; their triggers and owned sequences go too.
drop table if exists public.global_connection_reports;
drop table if exists public.global_connection_messages;
drop table if exists public.global_connection_threads;
drop table if exists public.global_connection_blocks;
drop table if exists public.global_connection_preferences;

drop function if exists public.enforce_global_connection_report_limit_v1();
drop function if exists public.enforce_global_connection_message_limit_v1();
drop function if exists public.enforce_global_connection_thread_limit_v1();
drop function if exists public.consume_global_connection_rate_limit_v1(text);
drop table if exists public.global_connection_rate_limits;

commit;
