create or replace function public.record_discovery_actions_v4(actions jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid:=auth.uid();
  result jsonb;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if jsonb_typeof(coalesce(actions,'[]'::jsonb))<>'array' then raise exception 'actions must be an array'; end if;
  if jsonb_array_length(coalesce(actions,'[]'::jsonb)) not between 1 and 20 then raise exception 'invalid action batch size'; end if;

  if exists(
    select 1
    from jsonb_to_recordset(actions) as item(
      "contentKind" text,"contentId" uuid,action text,"eventId" uuid
    )
    where coalesce(item."contentKind",'place')<>'place'
      or item."contentId" is null
      or item."eventId" is null
      or item.action not in ('saved','interested','dismissed','visited')
  ) or exists(
    select 1 from jsonb_to_recordset(actions) as item("contentId" uuid)
    group by item."contentId" having count(*)>1
  ) or exists(
    select 1 from jsonb_to_recordset(actions) as item("eventId" uuid)
    join public.discovery_action_receipts receipt
      on receipt.profile_id=actor and receipt.event_id=item."eventId"
  ) then
    return public.record_discovery_actions_v3(actions);
  end if;

  if (
    select count(*)<>count(distinct item."eventId")
    from jsonb_to_recordset(actions) as item("eventId" uuid)
  ) then raise exception 'eventId values must be unique'; end if;

  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));

  if exists(
    select 1
    from jsonb_to_recordset(actions) as item(
      "contentId" uuid,action text,"staticEphemeral" boolean
    )
    where not (coalesce(item."staticEphemeral",false) and item.action='dismissed')
      and not exists(
        select 1 from public.locations location
        where location.id=item."contentId" and location.status='published'
      )
  ) then raise exception 'place unavailable'; end if;

  with parsed as (
    select item.*
    from jsonb_to_recordset(actions) as item(
      "contentId" uuid,action text,"staticEphemeral" boolean
    )
    where coalesce(item."staticEphemeral",false) and item.action='dismissed'
  )
  insert into public.static_catalogue_actions(user_id,location_id,expires_at)
  select actor,parsed."contentId",now()+interval '90 days' from parsed
  on conflict(user_id,location_id) do update set expires_at=excluded.expires_at;

  with positive as (
    select item.*
    from jsonb_to_recordset(actions) as item("contentId" uuid,action text)
    where item.action in ('saved','interested','visited')
  )
  update public.discovery_actions history set undone_at=now()
  from positive
  where history.profile_id=actor and history.location_id=positive."contentId"
    and history.action='dismissed' and history.undone_at is null;

  with positive as (
    select item.*
    from jsonb_to_recordset(actions) as item("contentId" uuid,action text)
    where item.action in ('saved','interested','visited')
  )
  delete from public.user_content_states state
  using positive
  where state.profile_id=actor and state.location_id=positive."contentId"
    and state.state=positive.action;

  with positive as (
    select item.*
    from jsonb_to_recordset(actions) as item("contentId" uuid,action text)
    where item.action in ('saved','interested','visited')
  )
  insert into public.user_content_states(profile_id,event_id,location_id,state)
  select actor,null,positive."contentId",positive.action from positive;

  with writes as (
    select item.*
    from jsonb_to_recordset(actions) as item(
      "contentId" uuid,action text,"requestId" uuid,"staticEphemeral" boolean
    )
    where not (coalesce(item."staticEphemeral",false) and item.action='dismissed')
  )
  insert into public.discovery_actions(profile_id,request_id,content_kind,event_id,location_id,action)
  select actor,writes."requestId",'place',null,writes."contentId",writes.action from writes;

  with parsed as (
    select item.*
    from jsonb_to_recordset(actions) as item(
      "contentId" uuid,action text,"requestedAction" text,"eventId" uuid,context jsonb
    )
  ), queued as (
    select parsed.*,
      case
        when coalesce(parsed."requestedAction",parsed.action)='perfect' then 'perfect'
        when parsed.action='dismissed' then 'pass'
        when parsed.action in ('saved','interested') then 'save'
        when parsed.action='visited' then 'visited'
      end event_name,
      case
        when coalesce(parsed."requestedAction",parsed.action)='perfect' then 'perfect'
        when parsed.action in ('saved','interested') then 'saved'
        when parsed.action='visited' then 'visited'
      end touch_reason
    from parsed
    where exists(select 1 from public.locations location where location.id=parsed."contentId")
  )
  insert into public.discovery_context_outbox(
    profile_id,event_id,location_id,event_name,context_mode,context_category,
    context_payload,touch_reason
  )
  select actor,queued."eventId",queued."contentId",queued.event_name,
    coalesce(queued.context->>'mode','solo'),nullif(queued.context->>'category',''),
    coalesce(queued.context->'payload','{}'::jsonb),queued.touch_reason
  from queued
  on conflict(profile_id,event_id) do nothing;

  with parsed as (
    select item.*
    from jsonb_to_recordset(actions) as item(
      "contentId" uuid,action text,"requestedAction" text,"eventId" uuid,"sequence" integer
    )
  ), built as (
    select parsed."eventId",coalesce(parsed."sequence",0) sequence,
      jsonb_build_object(
        'action',parsed.action,'locationId',parsed."contentId",
        'perfectPick',coalesce(parsed."requestedAction",parsed.action)='perfect',
        'eventId',parsed."eventId",'sequence',coalesce(parsed."sequence",0)
      ) result
    from parsed
  )
  insert into public.discovery_action_receipts(profile_id,event_id,sequence,result)
  select actor,built."eventId",built.sequence,built.result from built;

  select coalesce(jsonb_agg(receipt.result order by receipt.sequence),'[]'::jsonb)
  into result
  from jsonb_to_recordset(actions) as item("eventId" uuid)
  join public.discovery_action_receipts receipt
    on receipt.profile_id=actor and receipt.event_id=item."eventId";
  return result;
end;
$$;
revoke all on function public.record_discovery_actions_v4(jsonb) from public,anon;
grant execute on function public.record_discovery_actions_v4(jsonb) to authenticated;
