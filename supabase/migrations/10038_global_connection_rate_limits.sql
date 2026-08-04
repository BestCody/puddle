-- Enforce paid global-connection abuse limits at the database boundary.
-- These triggers protect the RPCs even when a caller bypasses the product UI.

create table if not exists public.global_connection_rate_limits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  action_name text not null check (action_name in ('request','message','report')),
  window_name text not null check (window_name in ('minute','hour','day')),
  bucket_start timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key(user_id,action_name,window_name,bucket_start)
);
create index if not exists global_connection_rate_limits_cleanup_idx
  on public.global_connection_rate_limits(bucket_start);
alter table public.global_connection_rate_limits enable row level security;
revoke all on table public.global_connection_rate_limits from public,anon,authenticated;
grant select,insert,update,delete on table public.global_connection_rate_limits to service_role;

create or replace function public.consume_global_connection_rate_limit_v1(action_value text)
returns boolean
language plpgsql
volatile
security definer
set search_path=public
as $$
declare
  actor uuid:=auth.uid();
  short_window text;
  short_bucket timestamptz;
  short_limit integer;
  daily_limit integer;
  changed integer;
begin
  if actor is null then raise exception 'authentication required'; end if;

  case action_value
    when 'request' then
      short_window:='hour';
      short_bucket:=date_trunc('hour',now());
      short_limit:=8;
      daily_limit:=25;
    when 'message' then
      short_window:='minute';
      short_bucket:=date_trunc('minute',now());
      short_limit:=20;
      daily_limit:=300;
    when 'report' then
      short_window:='hour';
      short_bucket:=date_trunc('hour',now());
      short_limit:=10;
      daily_limit:=30;
    else
      raise exception 'invalid global connection rate-limit action';
  end case;

  perform pg_advisory_xact_lock(hashtextextended(actor::text||':global-connection:'||action_value,0));

  delete from public.global_connection_rate_limits limit_row
  where limit_row.user_id=actor
    and limit_row.action_name=action_value
    and limit_row.bucket_start<date_trunc('day',now())-interval '7 days';

  insert into public.global_connection_rate_limits(
    user_id,action_name,window_name,bucket_start,request_count,updated_at
  ) values(actor,action_value,short_window,short_bucket,1,now())
  on conflict(user_id,action_name,window_name,bucket_start) do update
    set request_count=global_connection_rate_limits.request_count+1,
        updated_at=now()
    where global_connection_rate_limits.request_count<short_limit;
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'global connection rate limit exceeded'; end if;

  insert into public.global_connection_rate_limits(
    user_id,action_name,window_name,bucket_start,request_count,updated_at
  ) values(actor,action_value,'day',date_trunc('day',now()),1,now())
  on conflict(user_id,action_name,window_name,bucket_start) do update
    set request_count=global_connection_rate_limits.request_count+1,
        updated_at=now()
    where global_connection_rate_limits.request_count<daily_limit;
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'global connection daily limit exceeded'; end if;

  return true;
end;
$$;
revoke all on function public.consume_global_connection_rate_limit_v1(text) from public,anon,authenticated;
grant execute on function public.consume_global_connection_rate_limit_v1(text) to service_role;

create or replace function public.enforce_global_connection_thread_limit_v1()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare actor uuid:=auth.uid();
begin
  if actor is not null then
    if new.requester_id<>actor then raise exception 'invalid connection requester'; end if;
    perform public.consume_global_connection_rate_limit_v1('request');
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_global_connection_thread_limit_v1() from public,anon,authenticated;
grant execute on function public.enforce_global_connection_thread_limit_v1() to service_role;

drop trigger if exists global_connection_thread_rate_limit on public.global_connection_threads;
create trigger global_connection_thread_rate_limit
before insert on public.global_connection_threads
for each row execute function public.enforce_global_connection_thread_limit_v1();

create or replace function public.enforce_global_connection_message_limit_v1()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid:=auth.uid();
  thread_status text;
begin
  if actor is not null then
    if new.sender_id<>actor then raise exception 'invalid message sender'; end if;
    select thread.status into thread_status
    from public.global_connection_threads thread
    where thread.id=new.thread_id
      and actor in (thread.requester_id,thread.recipient_id);
    if thread_status is null then raise exception 'conversation is unavailable'; end if;
    if thread_status='accepted' then
      perform public.consume_global_connection_rate_limit_v1('message');
    elsif thread_status<>'pending' then
      raise exception 'conversation is unavailable';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_global_connection_message_limit_v1() from public,anon,authenticated;
grant execute on function public.enforce_global_connection_message_limit_v1() to service_role;

drop trigger if exists global_connection_message_rate_limit on public.global_connection_messages;
create trigger global_connection_message_rate_limit
before insert on public.global_connection_messages
for each row execute function public.enforce_global_connection_message_limit_v1();

create or replace function public.enforce_global_connection_report_limit_v1()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare actor uuid:=auth.uid();
begin
  if actor is not null then
    if new.reporter_id<>actor then raise exception 'invalid report author'; end if;
    perform public.consume_global_connection_rate_limit_v1('report');
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_global_connection_report_limit_v1() from public,anon,authenticated;
grant execute on function public.enforce_global_connection_report_limit_v1() to service_role;

drop trigger if exists global_connection_report_rate_limit on public.global_connection_reports;
create trigger global_connection_report_rate_limit
before insert on public.global_connection_reports
for each row execute function public.enforce_global_connection_report_limit_v1();
