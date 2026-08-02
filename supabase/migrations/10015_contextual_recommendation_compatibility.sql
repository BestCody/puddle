-- Point the Group Hangout compatibility RPCs at the canonical contextual-v2
-- columns. The synchronization trigger keeps the older columns populated for
-- the Stage 8 base context while all new writes share one event representation.

create or replace function public.record_recommendation_context_v1(
  target_location uuid,
  event_name text,
  context_mode text default 'solo',
  context_category text default null,
  context_payload jsonb default '{}'::jsonb,
  context_deck uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid:=auth.uid();
  location_row public.locations%rowtype;
  effective_time timestamptz:=now();
  local_time timestamp;
  learned_source text;
  learned_source_key text;
  learned_outcome text;
  learned_weight numeric(6,3);
  learned_daypart text;
  learned_day_type text;
  learned_intent text;
  learned_metadata jsonb;
begin
  if actor is null then raise exception 'Authentication required.'; end if;
  if event_name not in ('opened','pass','save','perfect','matched','planned','visited','great','okay','not_for_us') then
    raise exception 'Context event is invalid.';
  end if;
  if context_mode not in ('solo','date','hangout') then context_mode:='solo'; end if;

  select * into location_row from public.locations where id=target_location;
  if location_row.id is null then raise exception 'Location is invalid.'; end if;

  learned_outcome:=case event_name
    when 'opened' then 'opened'
    when 'pass' then 'dismissed'
    when 'save' then 'saved'
    when 'perfect' then 'saved'
    when 'matched' then 'interested'
    when 'planned' then 'interested'
    else 'visited'
  end;
  learned_weight:=case event_name
    when 'opened' then 1
    when 'pass' then -3
    when 'save' then 4
    when 'perfect' then 7
    when 'matched' then 4
    when 'planned' then 5.5
    when 'visited' then 8
    when 'great' then 9
    when 'okay' then 5
    when 'not_for_us' then -5
  end;
  learned_source:=case
    when context_mode in ('date','hangout') and event_name in ('visited','great','okay','not_for_us') then 'date_match_feedback'
    when context_mode in ('date','hangout') then 'date_match_swipe'
    else 'discovery'
  end;
  learned_source_key:=case
    when context_deck is not null and event_name in ('pass','save','perfect') then
      'date_match_swipe:'||context_deck::text||':'||actor::text
    when context_deck is not null and event_name in ('visited','great','okay','not_for_us') then
      'date_match_feedback:'||context_deck::text||':'||actor::text
    when context_deck is not null then
      'shared_context:'||context_deck::text||':'||actor::text||':'||event_name
    else
      'context_rpc:'||actor::text||':'||target_location::text||':'||event_name||':'||txid_current()::text
  end;

  begin
    local_time:=timezone(coalesce(nullif(location_row.timezone,''),'UTC'),effective_time);
  exception when others then
    local_time:=timezone('UTC',effective_time);
  end;
  learned_daypart:=case
    when lower(coalesce(context_payload->>'daypart','')) in ('morning','afternoon','evening','late_night') then lower(context_payload->>'daypart')
    when lower(coalesce(context_payload->>'daypart',''))='late' then 'late_night'
    when extract(hour from local_time) between 5 and 11 then 'morning'
    when extract(hour from local_time) between 12 and 16 then 'afternoon'
    when extract(hour from local_time) between 17 and 21 then 'evening'
    else 'late_night'
  end;
  learned_day_type:=case when extract(isodow from local_time)>=6 then 'weekend' else 'weekday' end;
  learned_intent:=coalesce(public.contextual_intent_bucket_v1(coalesce(context_payload,'{}'::jsonb)),context_mode);
  learned_metadata:=coalesce(context_payload,'{}'::jsonb)||jsonb_build_object(
    'source','record_recommendation_context_v1',
    'event_type',event_name,
    'mode',context_mode,
    'deck_id',context_deck,
    'perfect_pick',event_name='perfect',
    'planned',event_name='planned'
  );

  insert into public.recommendation_context_events(
    profile_id,source,source_key,location_id,outcome,signal_weight,category,price_level,amenities,distance_m,
    daypart,day_type,intent,filters,metadata,occurred_at,undone_at,deck_id
  ) values(
    actor,learned_source,left(learned_source_key,180),target_location,learned_outcome,learned_weight,
    coalesce(nullif(trim(context_category),''),location_row.kind),location_row.price_level,coalesce(location_row.amenities,'{}'::text[]),
    case when coalesce(context_payload->>'distance_m','') ~ '^[0-9]+([.][0-9]+)?$' then (context_payload->>'distance_m')::real else null end,
    learned_daypart,learned_day_type,learned_intent,coalesce(context_payload,'{}'::jsonb),learned_metadata,effective_time,null,context_deck
  )
  on conflict(profile_id,source_key,location_id,outcome) do update set
    signal_weight=excluded.signal_weight,
    category=excluded.category,
    price_level=excluded.price_level,
    amenities=excluded.amenities,
    distance_m=coalesce(excluded.distance_m,recommendation_context_events.distance_m),
    daypart=excluded.daypart,
    day_type=excluded.day_type,
    intent=excluded.intent,
    filters=excluded.filters,
    metadata=recommendation_context_events.metadata||excluded.metadata,
    occurred_at=excluded.occurred_at,
    undone_at=null,
    deck_id=excluded.deck_id;

  return jsonb_build_object(
    'ok',true,
    'weight',learned_weight,
    'category',coalesce(nullif(trim(context_category),''),location_row.kind),
    'daypart',learned_daypart,
    'dayType',learned_day_type,
    'intent',learned_intent
  );
end;
$$;

create or replace function public.recommendation_context_scores_v1(
  target_mode text default 'solo',
  target_daypart text default 'any',
  target_weekend boolean default false
)
returns table(category text,affinity numeric,evidence_count bigint)
language sql
stable
security definer
set search_path=public
as $$
  with normalized as (
    select
      case when target_mode in ('solo','date','hangout') then target_mode else 'solo' end mode,
      case when target_daypart='late' then 'late_night' else target_daypart end daypart,
      case when target_weekend then 'weekend' else 'weekday' end day_type
  )
  select e.category,
    round((sum(e.signal_weight*case
      when coalesce(e.metadata->>'mode',e.mode)=n.mode and e.daypart=n.daypart and e.day_type=n.day_type then 1.45
      when coalesce(e.metadata->>'mode',e.mode)=n.mode then 1.2
      when coalesce(e.metadata->>'mode',e.mode)='solo' then 1.0
      else 0.72
    end)/greatest(1,sqrt(count(*)::numeric)))::numeric,3) affinity,
    count(*) evidence_count
  from public.recommendation_context_events e cross join normalized n
  where e.profile_id=auth.uid()
    and e.undone_at is null
    and e.occurred_at>now()-interval '180 days'
    and e.category is not null
  group by e.category
  order by affinity desc
  limit 100;
$$;

revoke all on function public.record_recommendation_context_v1(uuid,text,text,text,jsonb,uuid) from public;
revoke all on function public.recommendation_context_scores_v1(text,text,boolean) from public;
grant execute on function public.record_recommendation_context_v1(uuid,text,text,text,jsonb,uuid) to authenticated;
grant execute on function public.recommendation_context_scores_v1(text,text,boolean) to authenticated;

comment on function public.record_recommendation_context_v1(uuid,text,text,text,jsonb,uuid) is
  'Records solo, DateMatch, and Hangout signals in the canonical contextual-v2 recommendation event schema.';
