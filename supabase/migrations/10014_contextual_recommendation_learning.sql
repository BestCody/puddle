-- Contextual recommendation learning for the location-first Puddle product.
-- Learns bounded, recency-weighted preferences for category, price, amenities,
-- and travel distance within the user's current daypart, day type, and intent.

create table if not exists public.recommendation_context_events (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid references public.recommendation_requests(request_id) on delete set null,
  recommendation_outcome_id bigint references public.recommendation_outcomes(id) on delete set null,
  source text not null check (source in ('discovery','date_match_swipe','date_match_feedback','backfill')),
  source_key text not null check (char_length(source_key) between 1 and 180),
  location_id uuid not null references public.locations(id) on delete cascade,
  outcome text not null check (outcome in ('opened','saved','dismissed','interested','visited')),
  signal_weight numeric(6,3) not null check (signal_weight between -10 and 10 and signal_weight <> 0),
  category text,
  price_level smallint check (price_level between 1 and 4),
  amenities text[] not null default '{}',
  distance_m real check (distance_m is null or distance_m >= 0),
  daypart text not null check (daypart in ('morning','afternoon','evening','late_night')),
  day_type text not null check (day_type in ('weekday','weekend')),
  intent text,
  filters jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  undone_at timestamptz,
  unique(profile_id,source_key,location_id,outcome)
);
create index if not exists recommendation_context_events_profile_idx on public.recommendation_context_events(profile_id,occurred_at desc) where undone_at is null;
create index if not exists recommendation_context_events_location_idx on public.recommendation_context_events(location_id,occurred_at desc) where undone_at is null;

alter table public.recommendation_context_events enable row level security;
drop policy if exists recommendation_context_events_owner_select on public.recommendation_context_events;
create policy recommendation_context_events_owner_select on public.recommendation_context_events for select to authenticated using (profile_id=auth.uid());
revoke all on table public.recommendation_context_events from anon,authenticated;
grant select on table public.recommendation_context_events to authenticated;
grant select,insert,update,delete on table public.recommendation_context_events to service_role;
grant usage,select on sequence public.recommendation_context_events_id_seq to service_role;

create or replace function public.contextual_key_token_v1(value text)
returns text language sql immutable parallel safe as $$
  select left(trim(both '_' from regexp_replace(lower(trim(coalesce(value,''))),'[^a-z0-9_-]+','_','g')),60)
$$;

create or replace function public.contextual_intent_bucket_v1(source_filters jsonb)
returns text language plpgsql immutable parallel safe as $$
declare query_text text:=lower(concat_ws(' ',source_filters->>'q',source_filters->>'category',source_filters->>'amenity'));category_value text;
begin
  if query_text ~ '(coffee|cafe|espresso|tea|brunch|bakery)' then return 'coffee'; end if;
  if query_text ~ '(drink|cocktail|bar|pub|beer|wine|lounge)' then return 'drinks'; end if;
  if query_text ~ '(dinner|lunch|food|restaurant|meal|sushi|pizza|dessert)' then return 'meal'; end if;
  if query_text ~ '(park|walk|hike|trail|outdoor|sunset|scenic|garden|waterfront)' then return 'outdoors'; end if;
  if query_text ~ '(museum|gallery|art|culture|exhibit|theatre|theater)' then return 'culture'; end if;
  if query_text ~ '(activity|bowling|arcade|game|climb|skate|mini.?golf)' then return 'activity'; end if;
  if query_text ~ '(quiet|study|read|work|cozy|low.?key)' then return 'quiet'; end if;
  if query_text ~ '(romantic|date|anniversary|special)' then return 'romantic'; end if;
  if query_text ~ '(casual|hangout|chill|friends)' then return 'casual'; end if;
  category_value:=public.contextual_key_token_v1(source_filters->>'category');
  if category_value<>'' then return category_value; end if;
  if lower(coalesce(source_filters->>'openNow',source_filters->>'open_now','false')) in ('true','1') then return 'open_now'; end if;
  if lower(coalesce(source_filters->>'accessible','false')) in ('true','1') then return 'accessible'; end if;
  return null;
end;
$$;

-- Preserve the original Stage 8 functions as implementation primitives, then
-- keep their public names as backward-compatible contextual wrappers.
do $$
begin
  if to_regprocedure('public.recommendation_context_base_v1()') is null then
    alter function public.recommendation_context_v1() rename to recommendation_context_base_v1;
  end if;
  if to_regprocedure('public.record_recommendation_outcome_base_v1(uuid,text,uuid,text,jsonb)') is null then
    alter function public.record_recommendation_outcome_v1(uuid,text,uuid,text,jsonb) rename to record_recommendation_outcome_base_v1;
  end if;
  if to_regprocedure('public.recommendation_preference_text_base_v1(uuid)') is null then
    alter function public.recommendation_preference_text_v1(uuid) rename to recommendation_preference_text_base_v1;
  end if;
end $$;

create or replace function public.record_recommendation_outcome_v1(
  request_key uuid,
  target_kind text,
  target_id uuid,
  outcome_name text,
  outcome_metadata jsonb default '{}'::jsonb
) returns boolean language plpgsql security definer set search_path=public as $$
declare
  actor uuid:=auth.uid();
  recorded boolean;
  request_filters jsonb:='{}'::jsonb;
  candidate_category text;
  candidate_distance real;
  recorded_outcome_id bigint;
  learned_source_key text;
  location_row public.locations%rowtype;
  local_time timestamp;
  learned_outcome text;
  learned_weight numeric(6,3);
  learned_daypart text;
  learned_day_type text;
  learned_intent text;
begin
  recorded:=public.record_recommendation_outcome_base_v1(request_key,target_kind,target_id,outcome_name,coalesce(outcome_metadata,'{}'::jsonb));
  if actor is not null then
    select id into recorded_outcome_id from public.recommendation_outcomes
    where profile_id=actor and content_kind=target_kind and coalesce(event_id,location_id)=target_id and outcome=outcome_name
      and request_id is not distinct from request_key
    order by id desc limit 1;
  end if;
  learned_source_key:=case when recorded_outcome_id is not null then 'recommendation_outcome:'||recorded_outcome_id::text
    when request_key is not null then 'request:'||request_key::text||':'||outcome_name
    else 'rpc:'||target_id::text||':'||outcome_name||':'||txid_current()::text end;
  if actor is null or target_kind<>'place' then return recorded; end if;

  if outcome_name='undo' then
    update public.recommendation_context_events
      set undone_at=now(),metadata=metadata||jsonb_build_object('undone_by_request',request_key)
    where profile_id=actor and location_id=target_id and undone_at is null
      and (request_key is null or request_id=request_key);
    return recorded;
  end if;

  learned_outcome:=case when outcome_name in ('opened','saved','dismissed','interested','visited') then outcome_name end;
  if learned_outcome is null then return recorded; end if;
  learned_weight:=case
    when learned_outcome='visited' then 8
    when learned_outcome='saved' and lower(coalesce(outcome_metadata->>'perfect_pick','false')) in ('true','1') then 7
    when learned_outcome='saved' then 4
    when learned_outcome='interested' then 3
    when learned_outcome='opened' then 1
    when learned_outcome='dismissed' then -3
  end;

  select * into location_row from public.locations where id=target_id;
  if location_row.id is null then return recorded; end if;
  if request_key is not null then
    select coalesce(r.filters,'{}'::jsonb),c.category,c.distance_m
      into request_filters,candidate_category,candidate_distance
    from public.recommendation_requests r
    left join public.recommendation_candidates c on c.request_id=r.request_id and c.profile_id=actor and c.location_id=target_id
    where r.request_id=request_key and r.profile_id=actor;
  end if;
  request_filters:=coalesce(request_filters,'{}'::jsonb);

  begin
    local_time:=timezone(coalesce(nullif(location_row.timezone,''),'UTC'),now());
  exception when others then
    local_time:=timezone('UTC',now());
  end;
  learned_daypart:=case
    when extract(hour from local_time)>=5 and extract(hour from local_time)<12 then 'morning'
    when extract(hour from local_time)>=12 and extract(hour from local_time)<17 then 'afternoon'
    when extract(hour from local_time)>=17 and extract(hour from local_time)<22 then 'evening'
    else 'late_night'
  end;
  learned_day_type:=case when extract(isodow from local_time)>=6 then 'weekend' else 'weekday' end;
  learned_intent:=public.contextual_intent_bucket_v1(request_filters);

  insert into public.recommendation_context_events(
    profile_id,request_id,recommendation_outcome_id,source,source_key,location_id,outcome,signal_weight,category,price_level,amenities,distance_m,
    daypart,day_type,intent,filters,metadata,occurred_at,undone_at
  ) values(
    actor,request_key,recorded_outcome_id,'discovery',learned_source_key,target_id,learned_outcome,learned_weight,
    coalesce(nullif(candidate_category,''),location_row.kind),location_row.price_level,coalesce(location_row.amenities,'{}'::text[]),candidate_distance,
    learned_daypart,learned_day_type,learned_intent,request_filters,
    coalesce(outcome_metadata,'{}'::jsonb)||jsonb_build_object('source','recommendation_outcome_v1'),now(),null
  )
  on conflict(profile_id,source_key,location_id,outcome) do update set
    signal_weight=excluded.signal_weight,category=excluded.category,price_level=excluded.price_level,amenities=excluded.amenities,
    distance_m=excluded.distance_m,daypart=excluded.daypart,day_type=excluded.day_type,intent=excluded.intent,
    filters=excluded.filters,metadata=recommendation_context_events.metadata||excluded.metadata,occurred_at=excluded.occurred_at,undone_at=null;
  return recorded;
end;
$$;

create or replace function public.recommendation_context_v1()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  actor uuid:=auth.uid();
  base_context jsonb;
  reset_after timestamptz:='-infinity'::timestamptz;
  category_map jsonb:='{}'::jsonb;
  price_map jsonb:='{}'::jsonb;
  amenity_map jsonb:='{}'::jsonb;
  distance_map jsonb:='{}'::jsonb;
  signal_count integer:=0;
  confidence numeric:=0;
begin
  if actor is null then raise exception 'authentication required'; end if;
  base_context:=public.recommendation_context_base_v1();
  select coalesce(behavioral_reset_at,'-infinity'::timestamptz) into reset_after
    from public.recommendation_preferences where profile_id=actor;
  reset_after:=coalesce(reset_after,'-infinity'::timestamptz);

  with active as (
    select e.*,
      (e.signal_weight::double precision*exp(-greatest(0,extract(epoch from (now()-e.occurred_at))/86400.0)/45.0)) adjusted_weight
    from public.recommendation_context_events e
    where e.profile_id=actor and e.undone_at is null
      and e.occurred_at>=greatest(reset_after,now()-interval '180 days')
  ),category_signals as (
    select 'global|'||public.contextual_key_token_v1(category) key,adjusted_weight from active where nullif(category,'') is not null
    union all select 'daypart:'||daypart||'|'||public.contextual_key_token_v1(category),adjusted_weight from active where nullif(category,'') is not null
    union all select 'daytype:'||day_type||'|'||public.contextual_key_token_v1(category),adjusted_weight from active where nullif(category,'') is not null
    union all select 'intent:'||intent||'|'||public.contextual_key_token_v1(category),adjusted_weight from active where nullif(category,'') is not null and intent is not null
  ),category_grouped as (
    select key,sum(adjusted_weight) net,sum(abs(adjusted_weight)) mass from category_signals group by key
  ),price_signals as (
    select 'global|'||price_level::text key,adjusted_weight from active where price_level is not null
    union all select 'daypart:'||daypart||'|'||price_level::text,adjusted_weight from active where price_level is not null
    union all select 'daytype:'||day_type||'|'||price_level::text,adjusted_weight from active where price_level is not null
    union all select 'intent:'||intent||'|'||price_level::text,adjusted_weight from active where price_level is not null and intent is not null
  ),price_grouped as (
    select key,sum(adjusted_weight) net,sum(abs(adjusted_weight)) mass from price_signals group by key
  ),amenity_signals as (
    select 'global|'||public.contextual_key_token_v1(amenity) key,a.adjusted_weight from active a cross join lateral unnest(coalesce(a.amenities,'{}'::text[])) amenity
    union all select 'daypart:'||a.daypart||'|'||public.contextual_key_token_v1(amenity),a.adjusted_weight from active a cross join lateral unnest(coalesce(a.amenities,'{}'::text[])) amenity
    union all select 'daytype:'||a.day_type||'|'||public.contextual_key_token_v1(amenity),a.adjusted_weight from active a cross join lateral unnest(coalesce(a.amenities,'{}'::text[])) amenity
    union all select 'intent:'||a.intent||'|'||public.contextual_key_token_v1(amenity),a.adjusted_weight from active a cross join lateral unnest(coalesce(a.amenities,'{}'::text[])) amenity where a.intent is not null
  ),amenity_grouped as (
    select key,sum(adjusted_weight) net,sum(abs(adjusted_weight)) mass from amenity_signals where key<>'' group by key
  ),distance_signals as (
    select 'global|distance' key,distance_m,adjusted_weight from active where distance_m is not null and adjusted_weight>0
    union all select 'daypart:'||daypart||'|distance',distance_m,adjusted_weight from active where distance_m is not null and adjusted_weight>0
    union all select 'daytype:'||day_type||'|distance',distance_m,adjusted_weight from active where distance_m is not null and adjusted_weight>0
    union all select 'intent:'||intent||'|distance',distance_m,adjusted_weight from active where distance_m is not null and adjusted_weight>0 and intent is not null
  ),distance_grouped as (
    select key,sum((distance_m/1000.0)*adjusted_weight)/nullif(sum(adjusted_weight),0) preferred_km,count(*) support
    from distance_signals group by key having count(*)>=2 and sum(adjusted_weight)>0
  )
  select
    coalesce((select jsonb_object_agg(key,round((net/(8.0+mass))::numeric,4)) from category_grouped),'{}'::jsonb),
    coalesce((select jsonb_object_agg(key,round((net/(6.0+mass))::numeric,4)) from price_grouped),'{}'::jsonb),
    coalesce((select jsonb_object_agg(key,round((net/(6.0+mass))::numeric,4)) from amenity_grouped),'{}'::jsonb),
    coalesce((select jsonb_object_agg(key,round(preferred_km::numeric,2)) from distance_grouped),'{}'::jsonb),
    (select count(*)::integer from active)
  into category_map,price_map,amenity_map,distance_map,signal_count;

  confidence:=round(least(1.0,signal_count::numeric/12.0),4);
  return base_context||jsonb_build_object(
    'contextVersion','contextual-v2',
    'contextualCategory',category_map,
    'contextualPrice',price_map,
    'contextualAmenities',amenity_map,
    'contextualDistanceKm',distance_map,
    'contextualSignalCount',signal_count,
    'contextualConfidence',confidence
  );
end;
$$;

create or replace function public.recommendation_preference_text_v1(target_profile uuid)
returns text language sql stable security definer set search_path=public as $$
with prefs as (
  select coalesce(behavioral_enabled,true) behavioral_enabled,coalesce(explicit_interests_only,false) explicit_only,
    coalesce(behavioral_reset_at,'-infinity'::timestamptz) reset_at
  from (select 1) seed left join public.recommendation_preferences r on r.profile_id=target_profile
),context_text as (
  select string_agg(value,' | ' order by signal_weight desc,occurred_at desc) value from (
    select concat_ws(' ',l.name,l.kind,l.summary,e.intent,e.daypart,e.day_type,array_to_string(e.amenities,' ')) value,
      e.signal_weight,e.occurred_at
    from public.recommendation_context_events e join public.locations l on l.id=e.location_id,prefs
    where e.profile_id=target_profile and e.undone_at is null and e.signal_weight>0
      and prefs.behavioral_enabled and not prefs.explicit_only and e.occurred_at>=prefs.reset_at
    order by e.signal_weight desc,e.occurred_at desc limit 120
  ) ranked
)
select left(concat_ws(' | ',public.recommendation_preference_text_base_v1(target_profile),'Contextual location activity: '||(select value from context_text)),12000)
$$;

-- Context changes invalidate the user's preference embedding, just like other behavioral signals.
drop trigger if exists recommendation_context_events_queue_preference on public.recommendation_context_events;
create trigger recommendation_context_events_queue_preference
  after insert or update of signal_weight,undone_at on public.recommendation_context_events
  for each row execute function public.queue_preference_embedding_v1();

-- Backfill recent location outcomes so existing users receive contextual learning immediately.
insert into public.recommendation_context_events(
  profile_id,request_id,recommendation_outcome_id,source,source_key,location_id,outcome,signal_weight,category,price_level,amenities,distance_m,
  daypart,day_type,intent,filters,metadata,occurred_at
)
select
  o.profile_id,o.request_id,o.id,'backfill','recommendation_outcome:'||o.id::text,o.location_id,o.outcome,
  case
    when o.outcome='visited' then 8
    when o.outcome='saved' and lower(coalesce(o.metadata->>'perfect_pick','false')) in ('true','1') then 7
    when o.outcome='saved' then 4
    when o.outcome='interested' then 3
    when o.outcome='opened' then 1
    when o.outcome='dismissed' then -3
  end,
  coalesce(nullif(c.category,''),l.kind),l.price_level,coalesce(l.amenities,'{}'::text[]),c.distance_m,
  case
    when extract(hour from timezone(coalesce(nullif(l.timezone,''),'UTC'),o.created_at)) between 5 and 11 then 'morning'
    when extract(hour from timezone(coalesce(nullif(l.timezone,''),'UTC'),o.created_at)) between 12 and 16 then 'afternoon'
    when extract(hour from timezone(coalesce(nullif(l.timezone,''),'UTC'),o.created_at)) between 17 and 21 then 'evening'
    else 'late_night'
  end,
  case when extract(isodow from timezone(coalesce(nullif(l.timezone,''),'UTC'),o.created_at))>=6 then 'weekend' else 'weekday' end,
  public.contextual_intent_bucket_v1(coalesce(r.filters,'{}'::jsonb)),coalesce(r.filters,'{}'::jsonb),
  coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object('source','recommendation_outcomes_backfill'),o.created_at
from public.recommendation_outcomes o
join public.locations l on l.id=o.location_id
left join public.recommendation_requests r on r.request_id=o.request_id and r.profile_id=o.profile_id
left join public.recommendation_candidates c on c.request_id=o.request_id and c.profile_id=o.profile_id and c.location_id=o.location_id
where o.content_kind='place' and o.outcome in ('opened','saved','dismissed','interested','visited')
  and o.created_at>=now()-interval '180 days'
on conflict(profile_id,source_key,location_id,outcome) do nothing;

-- DateMatch is the product's strongest source of collaborative intent. Keep its
-- swipes and post-visit feedback in the same bounded context model.
create or replace function public.capture_date_match_context_v1()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare
  location_row public.locations%rowtype;
  deck_row public.date_match_decks%rowtype;
  match_time timestamptz;
  local_time timestamp;
  learned_outcome text;
  learned_weight numeric(6,3);
  learned_source text;
  learned_source_key text;
  learned_metadata jsonb:='{}'::jsonb;
  learned_distance real;
begin
  select * into location_row from public.locations where id=new.location_id;
  select * into deck_row from public.date_match_decks where id=new.deck_id;
  if location_row.id is null or deck_row.id is null then return new; end if;

  if tg_table_name='date_match_swipes' then
    learned_source:='date_match_swipe';
    learned_source_key:='date_match_swipe:'||new.deck_id::text||':'||new.profile_id::text;
    learned_outcome:=case when new.choice='pass' then 'dismissed' else 'saved' end;
    learned_weight:=case when new.choice='perfect' then 7 when new.choice='save' then 4 else -3 end;
    match_time:=coalesce(new.updated_at,new.created_at,now());
    learned_metadata:=jsonb_build_object('choice',new.choice,'perfect_pick',new.choice='perfect');
  else
    learned_source:='date_match_feedback';
    learned_source_key:='date_match_feedback:'||new.deck_id::text||':'||new.profile_id::text;
    update public.recommendation_context_events set undone_at=now()
      where profile_id=new.profile_id and source_key=learned_source_key and location_id=new.location_id and undone_at is null;
    if not new.happened then return new; end if;
    learned_outcome:='visited';
    learned_weight:=case when new.rating='great' then 9 when new.rating='okay' then 5 when new.rating='not_for_us' then -5 else 4 end;
    select coalesce(m.planned_for,new.updated_at,new.created_at,now()) into match_time
      from public.date_match_matches m where m.deck_id=new.deck_id and m.location_id=new.location_id;
    match_time:=coalesce(match_time,new.updated_at,new.created_at,now());
    learned_metadata:=jsonb_build_object('happened',new.happened,'rating',new.rating);
  end if;

  update public.recommendation_context_events set undone_at=now()
    where profile_id=new.profile_id and source_key=learned_source_key and location_id=new.location_id and undone_at is null;
  begin
    local_time:=timezone(coalesce(nullif(location_row.timezone,''),'UTC'),match_time);
  exception when others then
    local_time:=timezone('UTC',match_time);
  end;
  if deck_row.center_latitude is not null and deck_row.center_longitude is not null and location_row.point is not null then
    learned_distance:=st_distance(location_row.point,st_setsrid(st_makepoint(deck_row.center_longitude,deck_row.center_latitude),4326)::geography)::real;
  end if;

  insert into public.recommendation_context_events(
    profile_id,source,source_key,location_id,outcome,signal_weight,category,price_level,amenities,distance_m,
    daypart,day_type,intent,filters,metadata,occurred_at,undone_at
  ) values(
    new.profile_id,learned_source,learned_source_key,new.location_id,learned_outcome,learned_weight,location_row.kind,
    location_row.price_level,coalesce(location_row.amenities,'{}'::text[]),learned_distance,
    case when extract(hour from local_time) between 5 and 11 then 'morning'
      when extract(hour from local_time) between 12 and 16 then 'afternoon'
      when extract(hour from local_time) between 17 and 21 then 'evening' else 'late_night' end,
    case when extract(isodow from local_time)>=6 then 'weekend' else 'weekday' end,
    'date_match',jsonb_build_object('source','date_match'),learned_metadata||jsonb_build_object('deck_id',new.deck_id),match_time,null
  )
  on conflict(profile_id,source_key,location_id,outcome) do update set
    signal_weight=excluded.signal_weight,category=excluded.category,price_level=excluded.price_level,amenities=excluded.amenities,
    distance_m=excluded.distance_m,daypart=excluded.daypart,day_type=excluded.day_type,intent=excluded.intent,
    filters=excluded.filters,metadata=excluded.metadata,occurred_at=excluded.occurred_at,undone_at=null;
  return new;
end;
$$;

drop trigger if exists date_match_swipes_capture_context on public.date_match_swipes;
create trigger date_match_swipes_capture_context after insert or update of choice on public.date_match_swipes
  for each row execute function public.capture_date_match_context_v1();
drop trigger if exists date_match_feedback_capture_context on public.date_match_feedback;
create trigger date_match_feedback_capture_context after insert or update of happened,rating on public.date_match_feedback
  for each row execute function public.capture_date_match_context_v1();

create or replace function public.delete_recommendation_data_v1()
returns void language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();
begin
  if actor is null then raise exception 'authentication required'; end if;
  delete from public.recommendation_context_events where profile_id=actor;
  delete from public.recommendation_outcomes where profile_id=actor;
  delete from public.recommendation_candidates where profile_id=actor;
  delete from public.recommendation_requests where profile_id=actor;
  delete from public.recommendation_assignments where profile_id=actor;
  delete from public.discovery_impressions where profile_id=actor;
  delete from public.discovery_actions where profile_id=actor;
  update public.user_preference_embeddings set active=false,deleted_at=now() where profile_id=actor and deleted_at is null;
  delete from public.embedding_jobs where target_type='user' and profile_id=actor;
  insert into public.recommendation_preferences(profile_id,behavioral_enabled,friend_activity_enabled,vector_enabled,explicit_interests_only,behavioral_reset_at,updated_at)
  values(actor,false,false,false,true,now(),now())
  on conflict(profile_id) do update set behavioral_enabled=false,friend_activity_enabled=false,vector_enabled=false,explicit_interests_only=true,behavioral_reset_at=now(),updated_at=now();
end;
$$;

insert into public.recommendation_ranking_configs(version,active,weights,diversity,rollback_version,activated_at)
values(
  'contextual-v2',false,
  '{"explicitInterest":24,"behavioralAffinity":20,"negativeAffinity":14,"vectorSimilarity":20,"contextualCategory":12,"contextualPrice":7,"contextualAmenities":7,"contextualDistance":5,"proximity":16,"timeRelevance":14,"openingHours":9,"followedHost":11,"friendActivity":8,"popularity":7,"freshness":6,"novelty":6,"availability":4,"queryMatch":7,"verifiedHost":3,"exploration":3}'::jsonb,
  '{"hostPenalty":4,"categoryPenalty":3,"immediateCategoryPenalty":4,"kindPenalty":2,"explorationShare":0.1}'::jsonb,
  'hybrid-v1',now()
)
on conflict(version) do update set weights=excluded.weights,diversity=excluded.diversity,rollback_version=excluded.rollback_version;
update public.recommendation_ranking_configs set active=false where active and version<>'contextual-v2';
update public.recommendation_ranking_configs set active=true,activated_at=now() where version='contextual-v2';
update public.feature_flags
  set config=jsonb_set(coalesce(config,'{}'::jsonb),'{ranking_version}',to_jsonb('contextual-v2'::text),true),updated_at=now()
  where key='vector_recommendations_enabled';

revoke all on function public.contextual_key_token_v1(text) from public;
revoke all on function public.contextual_intent_bucket_v1(jsonb) from public;
revoke all on function public.capture_date_match_context_v1() from public,anon,authenticated;
revoke all on function public.recommendation_context_base_v1() from public,anon,authenticated;
revoke all on function public.record_recommendation_outcome_base_v1(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.recommendation_preference_text_base_v1(uuid) from public,anon,authenticated;
grant execute on function public.recommendation_context_v1() to authenticated;
grant execute on function public.record_recommendation_outcome_v1(uuid,text,uuid,text,jsonb) to authenticated;
grant execute on function public.recommendation_preference_text_v1(uuid) to service_role;
grant execute on function public.delete_recommendation_data_v1() to authenticated;

comment on table public.recommendation_context_events is 'Privacy-scoped, recency-weighted location interactions used for contextual recommendation learning.';
comment on function public.recommendation_context_v1() is 'Returns the Stage 8 context plus bounded category, price, amenity, and distance affinities for the current situation.';
