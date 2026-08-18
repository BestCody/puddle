-- Retire the removed shared date/hangout deck and static-catalogue/R2 runtimes.
-- Deliberately avoid CASCADE so an unexpected live dependency fails loudly.

-- Saved / Planned / Past are personal-location state only.
create or replace function public.location_history_page_v1(
  before_sort_at timestamptz default null,
  before_location_id uuid default null,
  result_limit integer default 25
)
returns table(
  location_id uuid,name text,slug text,summary text,kind text,city text,cover_path text,
  visited_at timestamptz,visit_source text,participants text[],cursor_at timestamptz,cursor_id uuid
)
language sql stable security definer set search_path='public'
as $$
  with state_rows as (
    select s.location_id,l.name,l.slug,l.summary,l.kind,l.city,l.cover_path,
      s.created_at as visited_at,'personal'::text as visit_source,array['You']::text[] as participants,
      s.created_at as sort_at
    from public.user_content_states s
    join public.locations l on l.id=s.location_id
    where s.profile_id=auth.uid() and s.state='visited'
      and l.status='published' and l.visibility='public' and not coalesce(l.has_private_address,false)
      and (before_sort_at is null or (s.created_at,s.location_id)<(before_sort_at,before_location_id))
    order by s.created_at desc,s.location_id desc
    limit greatest(1,least(coalesce(result_limit,25),41))
  ), visit_rows as (
    select v.location_id,l.name,l.slug,l.summary,l.kind,l.city,l.cover_path,
      coalesce(v.visited_at,v.created_at) as visited_at,'personal'::text as visit_source,
      array['You']::text[] as participants,coalesce(v.visited_at,v.created_at) as sort_at
    from public.location_visits v
    join public.locations l on l.id=v.location_id
    where v.profile_id=auth.uid() and v.status='visited'
      and l.status='published' and l.visibility='public' and not coalesce(l.has_private_address,false)
      and (before_sort_at is null or (coalesce(v.visited_at,v.created_at),v.location_id)<(before_sort_at,before_location_id))
    order by coalesce(v.visited_at,v.created_at) desc,v.location_id desc
    limit greatest(1,least(coalesce(result_limit,25),41))
  ), combined as (
    select * from state_rows
    union all
    select * from visit_rows
  ), deduped as (
    select *,row_number() over(partition by location_id order by sort_at desc,visit_source,location_id desc) as duplicate_rank
    from combined
  )
  select location_id,name,slug,summary,kind,city,cover_path,visited_at,visit_source,participants,
    sort_at as cursor_at,location_id as cursor_id
  from deduped where duplicate_rank=1
  order by sort_at desc,location_id desc
  limit greatest(1,least(coalesce(result_limit,25),41))
$$;

create or replace function public.location_plan_status_v1(target_location uuid)
returns table(status text,planned_for timestamptz,plan_source text,participants text[])
language sql stable security definer set search_path='public'
as $$
  select 'planned'::text,v.planned_for,'personal'::text,array['You']::text[]
  from public.location_visits v
  where v.profile_id=auth.uid() and v.location_id=target_location and v.status='planned'
  order by coalesce(v.planned_for,v.created_at)
  limit 1
$$;

create or replace function public.location_planned_page_v1(
  after_sort_at timestamptz default null,
  after_location_id uuid default null,
  result_limit integer default 25
)
returns table(
  location_id uuid,name text,slug text,summary text,kind text,city text,cover_path text,
  planned_for timestamptz,plan_source text,participants text[],cursor_at timestamptz,cursor_id uuid
)
language sql stable security definer set search_path='public'
as $$
  select v.location_id,l.name,l.slug,l.summary,l.kind,l.city,l.cover_path,v.planned_for,
    'personal'::text as plan_source,array['You']::text[] as participants,
    coalesce(v.planned_for,v.created_at) as cursor_at,v.location_id as cursor_id
  from public.location_visits v
  join public.locations l on l.id=v.location_id
  where v.profile_id=auth.uid() and v.status='planned'
    and l.status='published' and l.visibility='public' and not coalesce(l.has_private_address,false)
    and (after_sort_at is null or (coalesce(v.planned_for,v.created_at),v.location_id)>(after_sort_at,after_location_id))
  order by coalesce(v.planned_for,v.created_at),v.location_id
  limit greatest(1,least(coalesce(result_limit,25),41))
$$;

-- Recommendation context remains, but shared-deck identity and date_match_* sources are retired.
create or replace function public.sync_recommendation_context_event_v1()
returns trigger language plpgsql set search_path='public'
as $$
declare
  location_row public.locations%rowtype;
  effective_time timestamptz;
  normalized_event text;
  resolved_mode text;
begin
  if new.location_id is not null then select * into location_row from public.locations where id=new.location_id; end if;
  effective_time:=coalesce(new.occurred_at,new.created_at,now());
  normalized_event:=coalesce(new.event_type,case
    when new.outcome='opened' then 'opened'
    when new.outcome='dismissed' then 'pass'
    when new.outcome='saved' and lower(coalesce(new.metadata->>'perfect_pick','false')) in ('true','1') then 'perfect'
    when new.outcome='saved' then 'save'
    when new.outcome='interested' and lower(coalesce(new.metadata->>'planned','false')) in ('true','1') then 'planned'
    when new.outcome='interested' then 'matched'
    when new.outcome='visited' and new.signal_weight<0 then 'not_for_us'
    when new.outcome='visited' and new.signal_weight>=9 then 'great'
    when new.outcome='visited' and new.signal_weight between 1 and 6 then 'okay'
    when new.outcome='visited' then 'visited'
    else 'opened' end);
  resolved_mode:=case
    when new.metadata->>'mode' in ('solo','date','hangout') then new.metadata->>'mode'
    when new.mode in ('solo','date','hangout') then new.mode
    else 'solo' end;
  new.event_type:=normalized_event;
  new.mode:=resolved_mode;
  if new.source is null or new.source in ('date_match_swipe','date_match_feedback') then new.source:='discovery'; end if;
  new.source_key:=coalesce(nullif(new.source_key,''),'context-event:'||coalesce(new.id,gen_random_uuid())::text);
  new.outcome:=coalesce(new.outcome,case normalized_event
    when 'opened' then 'opened' when 'pass' then 'dismissed' when 'save' then 'saved' when 'perfect' then 'saved'
    when 'matched' then 'interested' when 'planned' then 'interested' else 'visited' end);
  new.signal_weight:=coalesce(new.signal_weight,nullif(new.weight,0),public.context_event_weight_v1(normalized_event));
  if coalesce(new.signal_weight,0)=0 then new.signal_weight:=1; end if;
  new.weight:=new.signal_weight;
  new.category:=coalesce(nullif(new.category,''),location_row.kind,'other');
  new.price_level:=coalesce(new.price_level,location_row.price_level);
  if new.amenities is null or cardinality(new.amenities)=0 then new.amenities:=coalesce(location_row.amenities,'{}'::text[]); end if;
  if new.distance_m is null and coalesce(new.context->>'distance_m','') ~ '^[0-9]+([.][0-9]+)?$' then new.distance_m:=(new.context->>'distance_m')::real; end if;
  new.daypart:=case
    when new.daypart in ('morning','afternoon','evening','late_night') then new.daypart
    when new.daypart='late' then 'late_night'
    when extract(hour from effective_time) between 5 and 11 then 'morning'
    when extract(hour from effective_time) between 12 and 16 then 'afternoon'
    when extract(hour from effective_time) between 17 and 21 then 'evening'
    else 'late_night' end;
  if new.day_type not in ('weekday','weekend') or (new.day_type='weekday' and new.weekend) then new.day_type:=case when new.weekend then 'weekend' else 'weekday' end; end if;
  new.weekend:=(new.day_type='weekend');
  if new.filters is null or new.filters='{}'::jsonb then new.filters:=coalesce(new.context,'{}'::jsonb); end if;
  new.intent:=coalesce(nullif(new.intent,''),nullif(new.filters->>'intent',''),nullif(new.context->>'intent',''),resolved_mode);
  new.metadata:=(coalesce(new.metadata,'{}'::jsonb)-'deck_id')||jsonb_build_object('mode',resolved_mode,'event_type',normalized_event);
  if new.context is null or new.context='{}'::jsonb then new.context:=new.filters; end if;
  new.context:=coalesce(new.context,'{}'::jsonb)||new.filters||jsonb_build_object('intent',new.intent,'mode',resolved_mode);
  new.occurred_at:=effective_time;
  new.created_at:=coalesce(new.created_at,effective_time);
  return new;
end
$$;

-- Keep opened/undo and unusual-batch fallback behavior, but remove staticEphemeral handling.
create or replace function public.record_discovery_actions_v3(actions jsonb)
returns jsonb language plpgsql security definer set search_path='public'
as $$
declare
  actor uuid:=auth.uid(); item jsonb; target_id uuid; action_name text; requested_action text;
  request_uuid uuid; event_uuid uuid; sequence_value integer; previous public.discovery_actions%rowtype;
  event_name text; action_result jsonb; stored_result jsonb; result jsonb:='[]'::jsonb;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if jsonb_typeof(coalesce(actions,'[]'::jsonb))<>'array' then raise exception 'actions must be an array'; end if;
  if jsonb_array_length(coalesce(actions,'[]'::jsonb)) not between 1 and 20 then raise exception 'invalid action batch size'; end if;
  for item in select value from jsonb_array_elements(actions) order by coalesce((value->>'sequence')::integer,0) loop
    if coalesce(item->>'contentKind','place')<>'place' then raise exception 'only place actions are supported'; end if;
    target_id:=(item->>'contentId')::uuid; action_name:=item->>'action'; requested_action:=coalesce(item->>'requestedAction',action_name);
    request_uuid:=nullif(item->>'requestId','')::uuid; event_uuid:=nullif(item->>'eventId','')::uuid; sequence_value:=coalesce((item->>'sequence')::integer,0);
    if event_uuid is null then raise exception 'eventId is required'; end if;
    if action_name not in ('saved','interested','dismissed','visited','opened','undo') then raise exception 'invalid action'; end if;
    perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||event_uuid::text,0));
    select receipt.result into stored_result from public.discovery_action_receipts receipt where receipt.profile_id=actor and receipt.event_id=event_uuid;
    if stored_result is not null then action_result:=stored_result;
    else
      if not exists(select 1 from public.locations where id=target_id and status='published') then raise exception 'place unavailable'; end if;
      if action_name='opened' then action_result:=jsonb_build_object('action','opened','locationId',target_id);
      elsif action_name='undo' then
        select * into previous from public.discovery_actions where profile_id=actor and location_id=target_id and undone_at is null order by created_at desc,id desc limit 1 for update;
        if previous.id is null then action_result:=jsonb_build_object('action','undo','locationId',target_id,'undone',false);
        else
          update public.discovery_actions set undone_at=now() where id=previous.id;
          if previous.action in ('saved','interested','visited') then delete from public.user_content_states where profile_id=actor and location_id=target_id and state=previous.action; end if;
          action_result:=jsonb_build_object('action','undo','locationId',target_id,'undone',true,'previousAction',previous.action);
        end if;
      else
        if action_name in ('saved','interested','visited') then
          update public.discovery_actions set undone_at=now() where profile_id=actor and location_id=target_id and action='dismissed' and undone_at is null;
          delete from public.user_content_states where profile_id=actor and location_id=target_id and state=action_name;
          insert into public.user_content_states(profile_id,event_id,location_id,state) values(actor,null,target_id,action_name);
        end if;
        insert into public.discovery_actions(profile_id,request_id,content_kind,event_id,location_id,action) values(actor,request_uuid,'place',null,target_id,action_name);
        action_result:=jsonb_build_object('action',action_name,'locationId',target_id,'perfectPick',requested_action='perfect');
      end if;
      event_name:=case when requested_action='perfect' then 'perfect' when action_name='dismissed' then 'pass' when action_name in ('saved','interested') then 'save' when action_name='visited' then 'visited' when action_name='opened' then 'opened' else null end;
      if event_name is not null then
        insert into public.discovery_context_outbox(profile_id,event_id,location_id,event_name,context_mode,context_category,context_payload)
        values(actor,event_uuid,target_id,event_name,coalesce(item#>>'{context,mode}','solo'),nullif(item#>>'{context,category}',''),coalesce(item#>'{context,payload}','{}'::jsonb))
        on conflict(profile_id,event_id) do nothing;
      end if;
      action_result:=action_result||jsonb_build_object('eventId',event_uuid,'sequence',sequence_value);
      insert into public.discovery_action_receipts(profile_id,event_id,sequence,result) values(actor,event_uuid,sequence_value,action_result);
    end if;
    result:=result||jsonb_build_array(action_result); stored_result:=null;
  end loop;
  return result;
end
$$;

create or replace function public.record_discovery_actions_v4_unchecked(actions jsonb)
returns jsonb language plpgsql security definer set search_path='public'
as $$
declare actor uuid:=auth.uid(); result jsonb;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if jsonb_typeof(coalesce(actions,'[]'::jsonb))<>'array' then raise exception 'actions must be an array'; end if;
  if jsonb_array_length(coalesce(actions,'[]'::jsonb)) not between 1 and 20 then raise exception 'invalid action batch size'; end if;
  if exists(
    select 1 from jsonb_to_recordset(actions) as item("contentKind" text,"contentId" uuid,action text,"eventId" uuid)
    where coalesce(item."contentKind",'place')<>'place' or item."contentId" is null or item."eventId" is null
      or item.action not in ('saved','interested','dismissed','visited')
  ) or exists(
    select 1 from jsonb_to_recordset(actions) as item("contentId" uuid) group by item."contentId" having count(*)>1
  ) or exists(
    select 1 from jsonb_to_recordset(actions) as item("eventId" uuid)
    join public.discovery_action_receipts receipt on receipt.profile_id=actor and receipt.event_id=item."eventId"
  ) then return public.record_discovery_actions_v3(actions); end if;
  if (select count(*)<>count(distinct item."eventId") from jsonb_to_recordset(actions) as item("eventId" uuid)) then raise exception 'eventId values must be unique'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  if exists(
    select 1 from jsonb_to_recordset(actions) as item("contentId" uuid)
    where not exists(select 1 from public.locations location where location.id=item."contentId" and location.status='published')
  ) then raise exception 'place unavailable'; end if;
  with positive as (
    select item.* from jsonb_to_recordset(actions) as item("contentId" uuid,action text) where item.action in ('saved','interested','visited')
  ) update public.discovery_actions history set undone_at=now() from positive
    where history.profile_id=actor and history.location_id=positive."contentId" and history.action='dismissed' and history.undone_at is null;
  with positive as (
    select item.* from jsonb_to_recordset(actions) as item("contentId" uuid,action text) where item.action in ('saved','interested','visited')
  ) delete from public.user_content_states state using positive
    where state.profile_id=actor and state.location_id=positive."contentId" and state.state=positive.action;
  with positive as (
    select item.* from jsonb_to_recordset(actions) as item("contentId" uuid,action text) where item.action in ('saved','interested','visited')
  ) insert into public.user_content_states(profile_id,event_id,location_id,state)
    select actor,null,positive."contentId",positive.action from positive;
  with writes as (
    select item.* from jsonb_to_recordset(actions) as item("contentId" uuid,action text,"requestId" uuid)
  ) insert into public.discovery_actions(profile_id,request_id,content_kind,event_id,location_id,action)
    select actor,writes."requestId",'place',null,writes."contentId",writes.action from writes;
  with parsed as (
    select item.* from jsonb_to_recordset(actions) as item("contentId" uuid,action text,"requestedAction" text,"eventId" uuid,context jsonb)
  ), queued as (
    select parsed.*,case
      when coalesce(parsed."requestedAction",parsed.action)='perfect' then 'perfect'
      when parsed.action='dismissed' then 'pass'
      when parsed.action in ('saved','interested') then 'save'
      when parsed.action='visited' then 'visited' end event_name
    from parsed
  ) insert into public.discovery_context_outbox(profile_id,event_id,location_id,event_name,context_mode,context_category,context_payload)
    select actor,queued."eventId",queued."contentId",queued.event_name,coalesce(queued.context->>'mode','solo'),nullif(queued.context->>'category',''),coalesce(queued.context->'payload','{}'::jsonb)
    from queued where queued.event_name is not null
    on conflict(profile_id,event_id) do nothing;
  with parsed as (
    select item.* from jsonb_to_recordset(actions) as item("contentId" uuid,action text,"requestedAction" text,"eventId" uuid,"sequence" integer)
  ), built as (
    select parsed."eventId",coalesce(parsed."sequence",0) sequence,
      jsonb_build_object('action',parsed.action,'locationId',parsed."contentId",'perfectPick',coalesce(parsed."requestedAction",parsed.action)='perfect','eventId',parsed."eventId",'sequence',coalesce(parsed."sequence",0)) result
    from parsed
  ) insert into public.discovery_action_receipts(profile_id,event_id,sequence,result)
    select actor,built."eventId",built.sequence,built.result from built;
  select coalesce(jsonb_agg(receipt.result order by receipt.sequence),'[]'::jsonb) into result
  from jsonb_to_recordset(actions) as item("eventId" uuid)
  join public.discovery_action_receipts receipt on receipt.profile_id=actor and receipt.event_id=item."eventId";
  return result;
end
$$;

create or replace function public.process_discovery_context_outbox_v1(batch_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='public'
as $$
declare safe_limit integer:=least(500,greatest(1,coalesce(batch_limit,100))); processed integer:=0;
begin
  if coalesce(auth.role()::text,'')<>'service_role' then raise exception 'service role required'; end if;
  create temporary table if not exists discovery_context_claims(
    id bigint primary key,profile_id uuid not null,event_id uuid not null,location_id uuid not null,
    event_name text,context_mode text,context_category text,context_payload jsonb,created_at timestamptz
  ) on commit drop;
  truncate discovery_context_claims;
  insert into discovery_context_claims
  select queued.id,queued.profile_id,queued.event_id,queued.location_id,queued.event_name,
    queued.context_mode,queued.context_category,queued.context_payload,queued.created_at
  from public.discovery_context_outbox queued where queued.processed_at is null
  order by queued.id for update skip locked limit safe_limit;
  insert into public.recommendation_context_events(
    profile_id,source,source_key,location_id,outcome,signal_weight,category,price_level,
    amenities,distance_m,daypart,day_type,intent,filters,metadata,occurred_at,undone_at
  )
  select claim.profile_id,'discovery','discovery_outbox:'||claim.event_id::text,claim.location_id,
    case claim.event_name when 'opened' then 'opened' when 'pass' then 'dismissed' when 'save' then 'saved' when 'perfect' then 'saved' else 'visited' end,
    case claim.event_name when 'opened' then 1 when 'pass' then -3 when 'save' then 4 when 'perfect' then 7 when 'visited' then 8 else 1 end,
    coalesce(claim.context_category,location.kind),location.price_level,coalesce(location.amenities,'{}'::text[]),null,
    case when claim.context_payload->>'daypart'='late' then 'late_night'
      when claim.context_payload->>'daypart' in ('morning','afternoon','evening','late_night') then claim.context_payload->>'daypart'
      when extract(hour from claim.created_at at time zone 'UTC') between 5 and 11 then 'morning'
      when extract(hour from claim.created_at at time zone 'UTC') between 12 and 16 then 'afternoon'
      when extract(hour from claim.created_at at time zone 'UTC') between 17 and 21 then 'evening' else 'late_night' end,
    case when extract(isodow from claim.created_at at time zone 'UTC')>=6 then 'weekend' else 'weekday' end,
    coalesce(public.contextual_intent_bucket_v1(coalesce(claim.context_payload,'{}'::jsonb)),claim.context_mode),
    coalesce(claim.context_payload,'{}'::jsonb),
    coalesce(claim.context_payload,'{}'::jsonb)||jsonb_build_object('source','discovery_context_outbox','event_type',claim.event_name,'mode',claim.context_mode,'perfect_pick',claim.event_name='perfect'),
    claim.created_at,null
  from discovery_context_claims claim join public.locations location on location.id=claim.location_id
  where claim.event_name is not null
  on conflict(profile_id,source_key,location_id,outcome) do nothing;
  update public.discovery_context_outbox queued set processed_at=now()
  from discovery_context_claims claim where queued.id=claim.id;
  get diagnostics processed=row_count;
  return jsonb_build_object('processed',processed);
end
$$;

-- Google matching is current. Keep v3, but remove its static-materialization prioritization dependency.
create or replace function public.claim_google_place_candidates_v3(batch_size integer default 100)
returns table(
  id uuid,name text,kind text,latitude double precision,longitude double precision,
  city text,region text,country text,country_code text,address_public text,attempt_count integer,
  candidate_place_ids text[],candidate_consensus numeric
)
language sql security definer set search_path='public'
as $$
  with base as materialized (
    select location.id,location.published_at
    from public.locations location
    where location.status='published' and location.visibility='public'
      and location.latitude is not null and location.longitude is not null
  ), candidate_grouped as materialized (
    select candidate.location_id,candidate.google_place_id,count(*)::integer as variant_count,
      sum(candidate.sightings)::integer as sightings,max(candidate.last_seen_at) as last_seen_at
    from public.google_place_id_candidates candidate
    group by candidate.location_id,candidate.google_place_id
  ), candidate_ranked as materialized (
    select candidate_grouped.*,
      least(0.99::numeric,0.45::numeric+least(4,candidate_grouped.variant_count)::numeric*0.12::numeric+least(10,candidate_grouped.sightings)::numeric*0.015::numeric) as consensus_score,
      row_number() over(partition by candidate_grouped.location_id order by candidate_grouped.variant_count desc,candidate_grouped.sightings desc,candidate_grouped.last_seen_at desc,candidate_grouped.google_place_id) as candidate_rank
    from candidate_grouped
  ), evidence as materialized (
    select candidate_ranked.location_id,
      array_agg(candidate_ranked.google_place_id order by candidate_ranked.variant_count desc,candidate_ranked.sightings desc,candidate_ranked.last_seen_at desc,candidate_ranked.google_place_id) as candidate_place_ids,
      max(candidate_ranked.consensus_score) as candidate_consensus
    from candidate_ranked where candidate_ranked.candidate_rank<=5
    group by candidate_ranked.location_id
  ), selected as materialized (
    select base.id,coalesce(attempt.attempt_count,0) as attempt_count,
      coalesce(evidence.candidate_place_ids,'{}'::text[]) as candidate_place_ids,
      coalesce(evidence.candidate_consensus,0::numeric) as candidate_consensus,
      case when attempt.location_id is null then 0 else 1 end as attempted_sort,
      base.published_at as touched_sort
    from base
    left join public.google_place_match_attempts attempt on attempt.location_id=base.id
    left join evidence on evidence.location_id=base.id
    where not exists(select 1 from public.location_google_places mapping where mapping.location_id=base.id and mapping.status='verified')
      and not exists(select 1 from public.location_photo_sources photo where photo.location_id=base.id and photo.status='approved' and photo.is_ai_generated is not true)
      and (attempt.location_id is null or attempt.retry_after is null or attempt.retry_after<=now() or (attempt.status='no_match' and attempt.last_attempt_at is not null and attempt.last_attempt_at<=now()-interval '6 hours'))
    order by coalesce(evidence.candidate_consensus,0) desc,
      case when attempt.location_id is null then 0 else 1 end,
      coalesce(attempt.attempt_count,0) asc,base.published_at desc nulls last,base.id
    limit greatest(1,least(coalesce(batch_size,100),5000))
  )
  select location.id,location.name,location.kind,location.latitude,location.longitude,
    location.city,location.region,location.country,location.country_code,location.address_public,
    selected.attempt_count,selected.candidate_place_ids,selected.candidate_consensus
  from selected join public.locations location on location.id=selected.id
  order by selected.candidate_consensus desc,selected.attempted_sort,selected.attempt_count,selected.touched_sort desc nulls last,selected.id
$$;

-- Normalize any old learning rows before narrowing the source contract.
update public.recommendation_context_events
set source='discovery',deck_id=null,metadata=coalesce(metadata,'{}'::jsonb)-'deck_id'
where source in ('date_match_swipe','date_match_feedback') or deck_id is not null;

alter table public.discovery_context_outbox drop column if exists touch_reason;
alter table public.recommendation_context_events drop constraint if exists recommendation_context_events_deck_id_fkey;
alter table public.recommendation_context_events drop column if exists deck_id;
alter table public.recommendation_context_events drop constraint if exists recommendation_context_events_source_check;
alter table public.recommendation_context_events add constraint recommendation_context_events_source_check check (source in ('discovery','backfill'));

-- Remove external triggers that still feed the retired static/R2 layer.
drop trigger if exists location_photo_sources_attach_r2_media on public.location_photo_sources;
drop trigger if exists location_photo_sources_retain_static on public.location_photo_sources;

-- Shared-deck RPCs are retired before their tables.
drop function if exists public.create_date_match_v1(uuid[],double precision,double precision);
drop function if exists public.create_shared_location_deck_v2(uuid[],double precision,double precision,text,integer,jsonb);
drop function if exists public.date_match_reveals_v1(uuid);
drop function if exists public.get_date_match_snapshot_v2(uuid);
drop function if exists public.is_date_match_member(uuid);
drop function if exists public.join_date_match_v1(text);
drop function if exists public.record_date_match_feedback_v1(uuid,uuid,boolean,text);
drop function if exists public.record_date_match_swipe_v1(uuid,uuid,text,text);
drop function if exists public.schedule_date_match_v1(uuid,uuid,timestamptz);
drop function if exists public.record_recommendation_context_v1(uuid,text,text,text,jsonb,uuid);

-- FK-safe shared-deck table order: feedback/swipes -> matches -> items -> members/versions -> decks.
drop table if exists public.date_match_feedback;
drop table if exists public.date_match_swipes;
drop table if exists public.date_match_matches;
drop table if exists public.date_match_items;
drop table if exists public.date_match_members;
drop table if exists public.date_match_room_versions;
drop table if exists public.date_match_decks;

drop function if exists public.capture_date_match_context_v1();
drop function if exists public.touch_date_match_room_version_v1();
drop function if exists public.refresh_location_rating_summary_trigger_v1();
drop function if exists public.refresh_location_rating_summary_v1(uuid);

-- Preserve the current card-quality API. The retired rating table is empty in production, so these
-- neutral values match current observable output while removing the dependency.
create or replace view public.location_card_quality_v1 as
select
  l.id as location_id,
  coalesce(d.description,public.location_factual_description_v1(l.name,l.kind,l.summary,l.neighborhood,l.city,l.price_level,l.amenities,l.opening_hours)) as description,
  coalesce(d.source,case when nullif(trim(l.summary),'') is not null then 'location_summary'::text else 'generated_factual'::text end) as description_source,
  nullif(trim(l.cover_path),'') is not null or exists(
    select 1 from public.location_photo_sources p where p.location_id=l.id and p.status='approved' and coalesce(p.is_ai_generated,false)=false
  ) as has_real_photo,
  case
    when (nullif(trim(l.cover_path),'') is not null or exists(select 1 from public.location_photo_sources p where p.location_id=l.id and p.status='approved' and coalesce(p.is_ai_generated,false)=false))
      and d.source in ('venue','editorial','community','wikipedia') then 3
    when nullif(trim(l.cover_path),'') is not null or exists(select 1 from public.location_photo_sources p where p.location_id=l.id and p.status='approved' and coalesce(p.is_ai_generated,false)=false) then 2
    else 1
  end::integer as card_tier,
  null::numeric(4,3) as average_rating,
  3.8::numeric as confidence_adjusted_rating,
  0::integer as rating_count,
  0::integer as happened_count,
  null::timestamptz as last_feedback_at
from public.locations l
left join lateral (
  select ld.description,ld.source
  from public.location_descriptions ld
  where ld.location_id=l.id and ld.status='approved'
  order by case ld.source when 'venue' then 1 when 'editorial' then 2 when 'community' then 3 when 'wikipedia' then 4 when 'location_summary' then 5 else 6 end,
    ld.verified_at desc nulls last,ld.updated_at desc
  limit 1
) d on true
where l.status='published' and l.visibility='public' and coalesce(l.has_private_address,false)=false;

drop table if exists public.location_rating_summaries;

-- Remove static/R2 worker functions before their tables where possible.
drop function if exists public.attach_static_location_asset_v1(uuid,uuid);
drop function if exists public.claim_static_media_resolution_v1(text,uuid,text,text,integer,integer);
drop function if exists public.consume_static_google_runtime_budget_v1(integer,integer);
drop function if exists public.delete_cold_static_materialization_v1(uuid);
drop function if exists public.finish_static_media_resolution_v1(text,uuid,uuid,text,text);
drop function if exists public.materialize_static_catalogue_location_v1(uuid,text,jsonb);
drop function if exists public.materialize_static_catalogue_locations_v2(jsonb);
drop function if exists public.prepare_r2_cleanup_v2(integer,integer,boolean);
drop function if exists public.reserve_static_photo_runtime_bytes_v1(bigint,bigint,bigint);
drop function if exists public.retain_static_location_with_photo_v1();
drop function if exists public.static_catalogue_launch_database_bytes_v1();
drop function if exists public.static_media_runtime_readiness_v1();
drop function if exists public.touch_static_catalogue_materializations_v1(uuid[],text);
drop function if exists public.upsert_static_location_asset_v1(uuid,text,text,uuid,text,text,text,text,text,text,text,real,text);
drop function if exists public.claim_google_place_candidates_v1(integer);
drop function if exists public.claim_google_place_candidates_v2(integer);
drop function if exists public.r2_discovery_overlay_v1(uuid[],double precision,double precision,integer,integer);
drop function if exists public.attach_r2_media_object_v1();

-- Internal static-table triggers are removed explicitly so their functions can be retired before table drops.
drop trigger if exists static_materialization_attach_asset on public.static_catalogue_materializations;
drop trigger if exists static_location_assets_attach_materialized on public.static_location_assets;
drop trigger if exists static_media_resolution_database_size_guard on public.static_media_resolution_states;
drop function if exists public.static_location_assets_attach_materialized_v1();
drop function if exists public.static_materialization_attach_asset_v1();
drop function if exists public.guard_static_media_resolution_database_size_v1();

drop table if exists public.static_location_assets;
drop table if exists public.static_catalogue_materializations;
drop table if exists public.static_catalogue_actions;
drop table if exists public.static_media_resolution_states;
drop table if exists public.static_google_runtime_budgets;
drop table if exists public.static_photo_runtime_budget;