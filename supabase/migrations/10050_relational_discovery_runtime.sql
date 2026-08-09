-- Finalize the relational discovery cutover without rewriting migration history.
-- Keep the installed RPC names/signatures used by the application, but remove the
-- active static-catalogue materialization/action compatibility paths.

create or replace function public.discovery_seen_locations_v1()
returns table(
  id uuid,
  duplicate_group_key text,
  catalogue_group_key text,
  name text,
  latitude double precision,
  longitude double precision
)
language sql
stable
security definer
set search_path=public
as $$
  with latest_swipe as (
    select distinct on (action.location_id)
      action.location_id,
      action.undone_at
    from public.discovery_actions action
    where action.profile_id=auth.uid()
      and action.location_id is not null
      and action.action in ('saved','interested','dismissed','visited')
    order by action.location_id,action.id desc
  ), seen_ids as (
    select latest.location_id
    from latest_swipe latest
    where latest.undone_at is null

    union

    select state.location_id
    from public.user_content_states state
    where state.profile_id=auth.uid()
      and state.location_id is not null
      and state.state in ('saved','interested','visited')
  )
  select location.id,
    location.duplicate_group_key,
    location.catalogue_group_key,
    location.name,
    location.latitude,
    location.longitude
  from public.locations location
  join seen_ids seen on seen.location_id=location.id
  where auth.uid() is not null
    and location.status='published';
$$;

revoke all on function public.discovery_seen_locations_v1() from public,anon;
grant execute on function public.discovery_seen_locations_v1() to authenticated;

-- The legacy function name remains an API compatibility boundary. Its contents are
-- now fully relational: every published public non-private location in range may be
-- considered, including imported catalogue rows. The static_ids argument is retained
-- only so deployed application callers do not need a coordinated signature change.
create or replace function public.r2_discovery_overlay_v1(
  static_ids uuid[],
  center_lat double precision,
  center_lng double precision,
  radius_m integer default 25000,
  max_rows integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid := auth.uid();
  safe_radius integer := least(100000,greatest(1000,coalesce(radius_m,25000)));
  safe_limit integer := least(120,greatest(1,coalesce(max_rows,60)));
  interests jsonb;
  location_rows jsonb;
  seen_ids uuid[];
begin
  if actor is null then raise exception 'authentication required'; end if;

  select coalesce(array_agg(seen.id),'{}'::uuid[])
  into seen_ids
  from public.discovery_seen_locations_v1() seen;

  select coalesce(to_jsonb(profile.interests),'[]'::jsonb)
  into interests
  from public.profiles profile
  where profile.id=actor;

  select coalesce(jsonb_agg(to_jsonb(candidate) order by candidate.distance_m asc), '[]'::jsonb)
  into location_rows
  from (
    select
      location.id,location.slug,location.name,location.summary,location.kind,
      location.timezone,location.timezone_verified,location.price_level,
      location.accessibility,location.amenities,location.opening_hours,
      location.latitude,location.longitude,location.neighborhood,location.city,
      location.region,location.region_code,location.country,location.country_code,
      location.postal_code,location.address_public,location.brand_id,location.brand_name,
      location.source_parent_place_id,location.duplicate_group_key,location.catalogue_group_key,
      location.cover_path,location.source,location.published_at,location.updated_at,
      google.google_place_id,google.match_score as google_place_match_score,
      photo.photo_url,photo.provider as photo_provider,
      photo.attribution_text as photo_attribution,
      photo.attribution_url as photo_attribution_url,
      photo.license_code as photo_license,
      (111320.0 * sqrt(
        power(location.latitude-center_lat,2) +
        power((location.longitude-center_lng)*cos(radians(center_lat)),2)
      ))::integer as distance_m
    from public.locations location
    left join lateral (
      select mapping.google_place_id,mapping.match_score
      from public.location_google_places mapping
      where mapping.location_id=location.id and mapping.status='verified'
      order by mapping.matched_at desc nulls last
      limit 1
    ) google on true
    left join lateral (
      select coalesce(media.public_url,source.remote_url) as photo_url,
        source.provider,source.attribution_text,source.attribution_url,source.license_code
      from public.location_photo_sources source
      left join public.media_objects media on media.id=source.media_object_id
      where source.location_id=location.id
        and source.status='approved'
        and source.is_ai_generated is not true
        and (source.expires_at is null or source.expires_at>now())
      order by source.is_primary desc nulls last,source.sort_order asc,source.verified_at desc nulls last
      limit 1
    ) photo on true
    where location.status='published'
      and location.visibility='public'
      and location.has_private_address is not true
      and not (location.id=any(coalesce(seen_ids,'{}'::uuid[])))
      and location.latitude between center_lat-safe_radius/111320.0 and center_lat+safe_radius/111320.0
      and location.longitude between center_lng-safe_radius/(111320.0*greatest(0.08,cos(radians(center_lat))))
                                 and center_lng+safe_radius/(111320.0*greatest(0.08,cos(radians(center_lat))))
    order by distance_m asc
    limit safe_limit
  ) candidate;

  return jsonb_build_object(
    'dismissedIds','[]'::jsonb,
    'interests',coalesce(interests,'[]'::jsonb),
    'locations',coalesce(location_rows,'[]'::jsonb)
  );
end;
$$;

revoke all on function public.r2_discovery_overlay_v1(uuid[],double precision,double precision,integer,integer) from public,anon;
grant execute on function public.r2_discovery_overlay_v1(uuid[],double precision,double precision,integer,integer) to authenticated;

-- Preserve the ordered/idempotent v3 fallback semantics for opened and undo actions,
-- but require every target to be a real published relational location.
create or replace function public.record_discovery_actions_v3(actions jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid := auth.uid();
  item jsonb;
  target_id uuid;
  action_name text;
  requested_action text;
  request_uuid uuid;
  event_uuid uuid;
  sequence_value integer;
  previous public.discovery_actions%rowtype;
  event_name text;
  action_result jsonb;
  stored_result jsonb;
  result jsonb := '[]'::jsonb;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if jsonb_typeof(coalesce(actions,'[]'::jsonb))<>'array' then raise exception 'actions must be an array'; end if;
  if jsonb_array_length(coalesce(actions,'[]'::jsonb)) not between 1 and 20 then raise exception 'invalid action batch size'; end if;

  for item in
    select value from jsonb_array_elements(actions)
    order by coalesce((value->>'sequence')::integer,0)
  loop
    if coalesce(item->>'contentKind','place')<>'place' then raise exception 'only place actions are supported'; end if;
    target_id := (item->>'contentId')::uuid;
    action_name := item->>'action';
    requested_action := coalesce(item->>'requestedAction',action_name);
    request_uuid := nullif(item->>'requestId','')::uuid;
    event_uuid := nullif(item->>'eventId','')::uuid;
    sequence_value := coalesce((item->>'sequence')::integer,0);
    if event_uuid is null then raise exception 'eventId is required'; end if;
    if action_name not in ('saved','interested','dismissed','visited','opened','undo') then raise exception 'invalid action'; end if;
    if not exists(select 1 from public.locations where id=target_id and status='published') then
      raise exception 'place unavailable';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||event_uuid::text,0));
    select receipt.result into stored_result
    from public.discovery_action_receipts receipt
    where receipt.profile_id=actor and receipt.event_id=event_uuid;

    if stored_result is not null then
      action_result := stored_result;
    elsif action_name='opened' then
      action_result := jsonb_build_object('action','opened','locationId',target_id);
    elsif action_name='undo' then
      select * into previous
      from public.discovery_actions
      where profile_id=actor and location_id=target_id and undone_at is null
      order by created_at desc,id desc limit 1 for update;
      if previous.id is null then
        action_result := jsonb_build_object('action','undo','locationId',target_id,'undone',false);
      else
        update public.discovery_actions set undone_at=now() where id=previous.id;
        if previous.action in ('saved','interested','visited') then
          delete from public.user_content_states
          where profile_id=actor and location_id=target_id and state=previous.action;
        end if;
        action_result := jsonb_build_object(
          'action','undo','locationId',target_id,'undone',true,'previousAction',previous.action
        );
      end if;
    else
      if action_name in ('saved','interested','visited') then
        update public.discovery_actions set undone_at=now()
        where profile_id=actor and location_id=target_id
          and action='dismissed' and undone_at is null;
        delete from public.user_content_states
        where profile_id=actor and location_id=target_id and state=action_name;
        insert into public.user_content_states(profile_id,event_id,location_id,state)
        values(actor,null,target_id,action_name);
      end if;
      insert into public.discovery_actions(
        profile_id,request_id,content_kind,event_id,location_id,action
      ) values(actor,request_uuid,'place',null,target_id,action_name);
      action_result := jsonb_build_object(
        'action',action_name,'locationId',target_id,'perfectPick',requested_action='perfect'
      );
    end if;

    event_name := case
      when requested_action='perfect' then 'perfect'
      when action_name='dismissed' then 'pass'
      when action_name in ('saved','interested') then 'save'
      when action_name='visited' then 'visited'
      when action_name='opened' then 'opened'
      else null
    end;
    if event_name is not null then
      perform public.record_recommendation_context_v1(
        target_location=>target_id,
        event_name=>event_name,
        context_mode=>coalesce(item#>>'{context,mode}','solo'),
        context_category=>nullif(item#>>'{context,category}',''),
        context_payload=>coalesce(item#>'{context,payload}','{}'::jsonb),
        context_deck=>null
      );
    end if;

    if stored_result is null then
      action_result := action_result || jsonb_build_object('eventId',event_uuid,'sequence',sequence_value);
      insert into public.discovery_action_receipts(profile_id,event_id,sequence,result)
      values(actor,event_uuid,sequence_value,action_result);
    end if;
    result := result || jsonb_build_array(action_result);
    stored_result := null;
  end loop;
  return result;
end;
$$;

revoke all on function public.record_discovery_actions_v3(jsonb) from public,anon;
grant execute on function public.record_discovery_actions_v3(jsonb) to authenticated;

-- Keep the optimized v4 write path, but remove the static-ephemeral dismissal branch.
create or replace function public.record_discovery_actions_v4_unchecked(actions jsonb)
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
    from jsonb_to_recordset(actions) as item("contentId" uuid)
    where not exists(
      select 1 from public.locations location
      where location.id=item."contentId" and location.status='published'
    )
  ) then raise exception 'place unavailable'; end if;

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
      "contentId" uuid,action text,"requestId" uuid
    )
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

revoke all on function public.record_discovery_actions_v4_unchecked(jsonb) from public,anon,authenticated;
