-- Runtime integrity hardening: reject moderated discovery writers at the database
-- boundary and make action receipts cover every v4 side effect, including the
-- recommendation context outbox.

create or replace function public.assert_active_profile_v1()
returns boolean
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  actor uuid:=auth.uid();
  suspended timestamptz;
  banned timestamptz;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  select profile.suspended_at,profile.banned_at
  into suspended,banned
  from public.profiles profile
  where profile.id=actor;
  if not found then raise exception 'profile required' using errcode='42501'; end if;
  if banned is not null then raise exception 'account banned' using errcode='42501'; end if;
  if suspended is not null then raise exception 'account suspended' using errcode='42501'; end if;
  return true;
end;
$$;
revoke all on function public.assert_active_profile_v1() from public,anon;
grant execute on function public.assert_active_profile_v1() to authenticated,service_role;

-- Preserve the optimized implementation as an internal function. The public v4
-- wrapper below strips already-receipted events before any state/context writes,
-- then rebuilds the response from receipts in the caller's sequence order.
alter function public.record_discovery_actions_v4(jsonb)
  rename to record_discovery_actions_v4_unchecked;
revoke all on function public.record_discovery_actions_v4_unchecked(jsonb) from public,anon,authenticated;

create or replace function public.record_discovery_actions_v4(actions jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid:=auth.uid();
  pending_actions jsonb;
  result jsonb;
  expected_count integer;
  receipt_count integer;
begin
  perform public.assert_active_profile_v1();
  if jsonb_typeof(coalesce(actions,'[]'::jsonb))<>'array' then raise exception 'actions must be an array'; end if;
  expected_count:=jsonb_array_length(coalesce(actions,'[]'::jsonb));
  if expected_count not between 1 and 20 then raise exception 'invalid action batch size'; end if;

  if exists(
    select 1
    from jsonb_array_elements(actions) item
    where nullif(item->>'eventId','') is null
  ) then raise exception 'eventId is required'; end if;

  if (
    select count(*)<>count(distinct item->>'eventId')
    from jsonb_array_elements(actions) item
  ) then raise exception 'eventId values must be unique'; end if;

  -- Serialize receipt inspection with writes for this profile so concurrent
  -- retries cannot both enter the unchecked implementation.
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));

  select coalesce(jsonb_agg(source.item order by source.ordinality),'[]'::jsonb)
  into pending_actions
  from jsonb_array_elements(actions) with ordinality source(item,ordinality)
  where not exists(
    select 1
    from public.discovery_action_receipts receipt
    where receipt.profile_id=actor
      and receipt.event_id=(source.item->>'eventId')::uuid
  );

  if jsonb_array_length(pending_actions)>0 then
    perform public.record_discovery_actions_v4_unchecked(pending_actions);
  end if;

  select
    coalesce(jsonb_agg(receipt.result order by coalesce((source.item->>'sequence')::integer,source.ordinality::integer-1)),'[]'::jsonb),
    count(receipt.event_id)
  into result,receipt_count
  from jsonb_array_elements(actions) with ordinality source(item,ordinality)
  left join public.discovery_action_receipts receipt
    on receipt.profile_id=actor
   and receipt.event_id=(source.item->>'eventId')::uuid;

  if receipt_count<>expected_count then raise exception 'action receipt was not recorded'; end if;
  return result;
end;
$$;
revoke all on function public.record_discovery_actions_v4(jsonb) from public,anon;
grant execute on function public.record_discovery_actions_v4(jsonb) to authenticated;
