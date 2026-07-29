-- Stage 8B: recommendation preferences, ranking versions, experiments, logs, and preference features.
-- Apply after 0014_ai_creation_and_embeddings.sql.

create table if not exists public.recommendation_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  behavioral_enabled boolean not null default true,
  friend_activity_enabled boolean not null default true,
  vector_enabled boolean not null default true,
  explicit_interests_only boolean not null default false,
  behavioral_reset_at timestamptz not null default '-infinity'::timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.recommendation_ranking_configs (
  version text primary key,
  active boolean not null default false,
  weights jsonb not null,
  diversity jsonb not null default '{}'::jsonb,
  rollback_version text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  activated_at timestamptz
);
insert into public.recommendation_ranking_configs(version,active,weights,diversity,rollback_version,activated_at) values(
  'hybrid-v1',true,
  '{"explicitInterest":24,"behavioralAffinity":20,"negativeAffinity":14,"vectorSimilarity":20,"proximity":16,"timeRelevance":14,"openingHours":9,"followedHost":11,"friendActivity":8,"popularity":7,"freshness":6,"novelty":6,"availability":4,"queryMatch":7,"verifiedHost":3,"exploration":3}'::jsonb,
  '{"hostPenalty":4,"categoryPenalty":3,"immediateCategoryPenalty":4,"kindPenalty":2,"explorationShare":0.1}'::jsonb,
  'rules-v2-fallback',now()
) on conflict(version) do nothing;
create unique index if not exists recommendation_ranking_one_active_idx on public.recommendation_ranking_configs(active) where active;

create or replace function public.activate_recommendation_ranking_v1(target_version text)
returns text language plpgsql security definer set search_path=public as $$
declare prior text;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'admin authorization required'; end if;
  if not exists(select 1 from public.recommendation_ranking_configs where version=target_version) then raise exception 'ranking version not found'; end if;
  select version into prior from public.recommendation_ranking_configs where active limit 1;
  update public.recommendation_ranking_configs set active=false where active;
  update public.recommendation_ranking_configs set active=true,activated_at=now() where version=target_version;
  update public.feature_flags set config=jsonb_set(config,'{ranking_version}',to_jsonb(target_version),true),updated_by=auth.uid(),updated_at=now() where key='vector_recommendations_enabled';
  insert into public.audit_logs(actor_id,action,target_type,target_id,before_data,after_data,reason)
  values(auth.uid(),'recommendation_ranking_activated','recommendation_ranking',target_version,jsonb_build_object('version',prior),jsonb_build_object('version',target_version),'Stage 8 ranking activation or rollback');
  return target_version;
end;
$$;

create table if not exists public.recommendation_experiments (
  key text primary key,
  enabled boolean not null default false,
  salt text not null,
  variants jsonb not null,
  starts_at timestamptz,
  ends_at timestamptz,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.recommendation_experiments(key,enabled,salt,variants,config) values(
  'hybrid-ranking-v1',true,'puddle-stage8-v1',
  '[{"name":"control","start":0,"end":4499,"holdout":false},{"name":"vector_boost","start":4500,"end":8999,"holdout":false},{"name":"rules_holdout","start":9000,"end":9999,"holdout":true}]'::jsonb,
  '{"minimum_sample":500,"rollback_version":"rules-v1"}'::jsonb
) on conflict(key) do nothing;

create table if not exists public.recommendation_assignments (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  experiment_key text not null references public.recommendation_experiments(key) on delete cascade,
  variant text not null,
  bucket integer not null check (bucket between 0 and 9999),
  holdout boolean not null default false,
  assigned_at timestamptz not null default now(),
  primary key(profile_id,experiment_key)
);

create table if not exists public.recommendation_requests (
  request_id uuid primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  ranking_version text not null,
  experiment_key text,
  experiment_variant text,
  holdout boolean not null default false,
  filters jsonb not null default '{}'::jsonb,
  fallback_reason text,
  vector_enabled boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists recommendation_requests_profile_idx on public.recommendation_requests(profile_id,created_at desc);

create table if not exists public.recommendation_eligibility_logs (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.recommendation_requests(request_id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  content_kind text not null check (content_kind in ('event','place')),
  event_id uuid references public.events(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  eligible boolean not null,
  rejection_reasons text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint recommendation_eligibility_target_check check ((content_kind='event' and event_id is not null and location_id is null) or (content_kind='place' and location_id is not null and event_id is null)),
  unique(request_id,content_kind,event_id,location_id)
);
create unique index if not exists recommendation_eligibility_dedupe_idx on public.recommendation_eligibility_logs(request_id,content_kind,coalesce(event_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(location_id,'00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.recommendation_candidates (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.recommendation_requests(request_id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  content_kind text not null check (content_kind in ('event','place')),
  event_id uuid references public.events(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  candidate_sources text[] not null default '{}',
  category text,
  distance_m real,
  host_id uuid references public.host_profiles(id) on delete set null,
  eligibility jsonb not null default '{}'::jsonb,
  score_components jsonb not null default '{}'::jsonb,
  vector_similarity real,
  final_score numeric(10,4) not null,
  rank_position integer not null check (rank_position between 1 and 500),
  explanations text[] not null default '{}',
  embedding_model_version text,
  impression_key text not null,
  created_at timestamptz not null default now(),
  constraint recommendation_candidate_one_target check (num_nonnulls(event_id,location_id)=1),
  constraint recommendation_candidate_target_check check ((content_kind='event' and event_id is not null and location_id is null) or (content_kind='place' and location_id is not null and event_id is null))
);
create unique index if not exists recommendation_candidates_request_dedupe_idx on public.recommendation_candidates(request_id,content_kind,coalesce(event_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(location_id,'00000000-0000-0000-0000-000000000000'::uuid));
create unique index if not exists recommendation_candidates_impression_dedupe_idx on public.recommendation_candidates(profile_id,content_kind,coalesce(event_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(location_id,'00000000-0000-0000-0000-000000000000'::uuid),impression_key);
create index if not exists recommendation_candidates_profile_idx on public.recommendation_candidates(profile_id,created_at desc);

create table if not exists public.recommendation_outcomes (
  id bigint generated always as identity primary key,
  request_id uuid references public.recommendation_requests(request_id) on delete set null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  content_kind text not null check (content_kind in ('event','place')),
  event_id uuid references public.events(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  outcome text not null check (outcome in ('impression','opened','saved','dismissed','interested','rsvp','ticket_purchase','visited','followed_host','undo','report','block')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint recommendation_outcome_one_target check (num_nonnulls(event_id,location_id)=1)
);
create unique index if not exists recommendation_outcomes_dedupe_idx on public.recommendation_outcomes(profile_id,request_id,content_kind,coalesce(event_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(location_id,'00000000-0000-0000-0000-000000000000'::uuid),outcome) where request_id is not null;
create index if not exists recommendation_outcomes_profile_idx on public.recommendation_outcomes(profile_id,created_at desc);

create table if not exists public.recommendation_metrics (
  id bigint generated always as identity primary key,
  metric_date date not null,
  ranking_version text not null,
  experiment_variant text,
  metric_name text not null,
  metric_value double precision not null,
  sample_size bigint not null default 0,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(metric_date,ranking_version,experiment_variant,metric_name)
);

create or replace function public.assign_recommendation_experiment_v1(target_experiment text default 'hybrid-ranking-v1')
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();exp public.recommendation_experiments%rowtype;existing public.recommendation_assignments%rowtype;bucket_value integer;selected_variant text:='control';selected_holdout boolean:=false;
begin
  if actor is null then raise exception 'authentication required'; end if;
  select * into existing from public.recommendation_assignments where profile_id=actor and experiment_key=target_experiment;
  if existing.profile_id is not null then return jsonb_build_object('experiment',target_experiment,'variant',existing.variant,'bucket',existing.bucket,'holdout',existing.holdout); end if;
  select * into exp from public.recommendation_experiments where key=target_experiment and enabled and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>now());
  if exp.key is null then return jsonb_build_object('experiment',target_experiment,'variant','control','bucket',0,'holdout',false); end if;
  bucket_value:=mod((hashtextextended(actor::text||':'||exp.salt,0) & 9223372036854775807)::numeric,10000)::integer;
  select value->>'name',coalesce((value->>'holdout')::boolean,false) into selected_variant,selected_holdout
  from jsonb_array_elements(exp.variants) where bucket_value between (value->>'start')::integer and (value->>'end')::integer limit 1;
  selected_variant:=coalesce(selected_variant,'control');
  insert into public.recommendation_assignments(profile_id,experiment_key,variant,bucket,holdout)
  values(actor,target_experiment,selected_variant,bucket_value,selected_holdout)
  on conflict(profile_id,experiment_key) do update set variant=excluded.variant,bucket=excluded.bucket,holdout=excluded.holdout,assigned_at=now();
  return jsonb_build_object('experiment',target_experiment,'variant',selected_variant,'bucket',bucket_value,'holdout',selected_holdout);
end;
$$;

create or replace function public.recommendation_context_v1()
returns jsonb language sql stable security definer set search_path=public as $$
with actor as (select auth.uid() id),
prefs as (
  select coalesce(r.behavioral_enabled,true) behavioral_enabled,coalesce(r.friend_activity_enabled,true) friend_activity_enabled,
    coalesce(r.vector_enabled,true) vector_enabled,coalesce(r.explicit_interests_only,false) explicit_interests_only,
    coalesce(r.behavioral_reset_at,'-infinity'::timestamptz) reset_at
  from actor a left join public.recommendation_preferences r on r.profile_id=a.id
),positive_raw as (
  select e.category,case d.action when 'visited' then 5 when 'saved' then 3 when 'interested' then 2 else 0 end::numeric weight,d.created_at
  from public.discovery_actions d join actor a on a.id=d.profile_id join public.events e on e.id=d.event_id where d.undone_at is null
  union all
  select l.kind,case d.action when 'visited' then 5 when 'saved' then 3 when 'interested' then 2 else 0 end::numeric,d.created_at
  from public.discovery_actions d join actor a on a.id=d.profile_id join public.locations l on l.id=d.location_id where d.undone_at is null
  union all
  select e.category,case s.state when 'visited' then 6 when 'attending' then 5 when 'saved' then 3 when 'interested' then 2 else 0 end::numeric,s.created_at
  from public.user_content_states s join actor a on a.id=s.profile_id join public.events e on e.id=s.event_id where s.state in ('saved','interested','attending','visited')
  union all
  select l.kind,case s.state when 'visited' then 6 when 'saved' then 3 else 0 end::numeric,s.created_at
  from public.user_content_states s join actor a on a.id=s.profile_id join public.locations l on l.id=s.location_id where s.state in ('saved','visited')
  union all
  select e.category,4::numeric,s.created_at from public.event_saves s join actor a on a.id=s.profile_id join public.events e on e.id=s.event_id
  union all
  select e.category,case w.direction when 'more_like_this' then 5 when 'right' then 3 else 0 end::numeric,w.updated_at
  from public.event_swipes w join actor a on a.id=w.profile_id join public.events e on e.id=w.event_id where w.direction in ('right','more_like_this')
  union all
  select e.category,case r.status when 'checked_in' then 7 when 'going' then 5 when 'interested' then 2 when 'requested' then 2 else 0 end::numeric,r.created_at
  from public.event_rsvps r join actor a on a.id=r.profile_id join public.events e on e.id=r.event_id where r.status in ('interested','requested','going','checked_in')
  union all
  select e.category,8::numeric,c.checked_in_at from public.event_checkins c join actor a on a.id=c.profile_id join public.events e on e.id=c.event_id where c.reversed_at is null
  union all
  select e.category,8::numeric,t.created_at from public.tickets t join actor a on a.id=t.owner_id join public.ticket_types tt on tt.id=t.ticket_type_id join public.events e on e.id=tt.event_id where t.status in ('valid','checked_in')
  union all
  select l.kind,case v.status when 'visited' then 7 when 'planned' then 2 else 0 end::numeric,v.updated_at from public.location_visits v join actor a on a.id=v.profile_id join public.locations l on l.id=v.location_id where v.status in ('visited','planned')
),positive as (
  select category,least(25,sum(weight)) weight from positive_raw,prefs where behavioral_enabled and not explicit_interests_only and created_at>=reset_at and category is not null group by category
),negative_raw as (
  select coalesce(e.category,l.kind) category,d.created_at
  from public.discovery_actions d join actor a on a.id=d.profile_id left join public.events e on e.id=d.event_id left join public.locations l on l.id=d.location_id
  where d.action='dismissed' and d.undone_at is null
  union all
  select e.category,w.updated_at from public.event_swipes w join actor a on a.id=w.profile_id join public.events e on e.id=w.event_id where w.direction in ('left','less_like_this')
),negative as (
  select category,least(12,count(*)::numeric*2) weight from negative_raw,prefs
  where behavioral_enabled and not explicit_interests_only and created_at>=reset_at and category is not null group by category
),friends as (
  select case when f.requester_id=(select id from actor) then f.addressee_id else f.requester_id end friend_id from public.friendships f
  where f.state='accepted' and ((f.requester_id=(select id from actor)) or (f.addressee_id=(select id from actor)))
    and not exists(select 1 from public.blocks b where (b.blocker_id=(select id from actor) and b.blocked_id=case when f.requester_id=(select id from actor) then f.addressee_id else f.requester_id end) or (b.blocked_id=(select id from actor) and b.blocker_id=case when f.requester_id=(select id from actor) then f.addressee_id else f.requester_id end))
),friend_categories as (
  select coalesce(e.category,l.kind) category,least(10,count(*)::numeric) weight
  from public.discovery_actions d join friends f on f.friend_id=d.profile_id join public.profiles fp on fp.id=f.friend_id left join public.events e on e.id=d.event_id left join public.locations l on l.id=d.location_id,prefs
  where friend_activity_enabled and (fp.activity_visibility in ('friends','public') or (fp.activity_visibility='close_friends' and exists(select 1 from public.friend_close_friends cf where cf.profile_id=fp.id and cf.friend_id=(select id from actor)))) and d.undone_at is null and d.action in ('saved','interested','visited') and d.created_at>now()-interval '60 days'
  group by coalesce(e.category,l.kind)
),recent as (
  select array_agg(distinct content_kind||':'||coalesce(event_id,location_id)::text) targets from public.discovery_impressions i join actor a on a.id=i.profile_id where i.created_at>now()-interval '30 days'
)
select jsonb_build_object(
  'explicitInterests',coalesce((select to_jsonb(interests) from public.profiles p join actor a on a.id=p.id),'[]'::jsonb),
  'positiveCategories',coalesce((select jsonb_object_agg(category,weight) from positive),'{}'::jsonb),
  'negativeCategories',coalesce((select jsonb_object_agg(category,weight) from negative),'{}'::jsonb),
  'friendCategories',coalesce((select jsonb_object_agg(category,weight) from friend_categories),'{}'::jsonb),
  'followedHosts',coalesce((select jsonb_agg(host_profile_id) from public.host_follows h join actor a on a.id=h.profile_id),'[]'::jsonb),
  'recentTargets',coalesce((select to_jsonb(targets) from recent),'[]'::jsonb),
  'preferences',(select to_jsonb(prefs) from prefs),
  'featureFlags',jsonb_build_object('vector',public.feature_enabled_v1('vector_recommendations_enabled'),'behavioral',public.feature_enabled_v1('behavioral_recommendations_enabled')),
  'rankingConfig',coalesce((select to_jsonb(rc) from public.recommendation_ranking_configs rc where rc.active order by rc.activated_at desc nulls last,rc.created_at desc limit 1),'{}'::jsonb)
)
$$;

create or replace function public.recommendation_preference_text_v1(target_profile uuid)
returns text language sql stable security definer set search_path=public as $$
with prefs as (
  select coalesce(behavioral_enabled,true) behavioral_enabled,coalesce(explicit_interests_only,false) explicit_only,coalesce(behavioral_reset_at,'-infinity'::timestamptz) reset_at
  from (select 1) seed left join public.recommendation_preferences r on r.profile_id=target_profile
),interests as (select array_to_string(coalesce(interests,'{}'::text[]),' ') value from public.profiles where id=target_profile),
positive as (
  select string_agg(value,' | ' order by weight desc) value from (
    select concat_ws(' ',e.title,e.category,e.summary) value,case r.status when 'checked_in' then 8 when 'going' then 5 else 2 end weight,r.created_at occurred_at
    from public.event_rsvps r join public.events e on e.id=r.event_id where r.profile_id=target_profile and r.status in ('interested','requested','going','checked_in')
    union all
    select concat_ws(' ',l.name,l.kind,l.summary),case v.status when 'visited' then 7 else 2 end,v.updated_at from public.location_visits v join public.locations l on l.id=v.location_id where v.profile_id=target_profile and v.status in ('visited','planned')
    union all
    select concat_ws(' ',e.title,e.category,e.summary),case d.action when 'visited' then 6 when 'saved' then 4 else 2 end,d.created_at from public.discovery_actions d join public.events e on e.id=d.event_id where d.profile_id=target_profile and d.undone_at is null and d.action in ('saved','interested','visited')
    union all
    select concat_ws(' ',l.name,l.kind,l.summary),case d.action when 'visited' then 6 when 'saved' then 4 else 2 end,d.created_at from public.discovery_actions d join public.locations l on l.id=d.location_id where d.profile_id=target_profile and d.undone_at is null and d.action in ('saved','interested','visited')
    union all
    select concat_ws(' ',e.title,e.category,e.summary),case s.state when 'visited' then 6 when 'attending' then 5 when 'saved' then 4 else 2 end,s.created_at from public.user_content_states s join public.events e on e.id=s.event_id where s.profile_id=target_profile and s.state in ('saved','interested','attending','visited')
    union all
    select concat_ws(' ',l.name,l.kind,l.summary),case s.state when 'visited' then 6 else 4 end,s.created_at from public.user_content_states s join public.locations l on l.id=s.location_id where s.profile_id=target_profile and s.state in ('saved','visited')
    union all
    select concat_ws(' ',e.title,e.category,e.summary),4,s.created_at from public.event_saves s join public.events e on e.id=s.event_id where s.profile_id=target_profile
    union all
    select concat_ws(' ',e.title,e.category,e.summary),case w.direction when 'more_like_this' then 5 else 3 end,w.updated_at from public.event_swipes w join public.events e on e.id=w.event_id where w.profile_id=target_profile and w.direction in ('right','more_like_this')
    union all
    select concat_ws(' ',e.title,e.category,e.summary),8,t.created_at from public.tickets t join public.ticket_types tt on tt.id=t.ticket_type_id join public.events e on e.id=tt.event_id where t.owner_id=target_profile and t.status in ('valid','checked_in')
    order by weight desc limit 120
  ) ranked,prefs where prefs.behavioral_enabled and not prefs.explicit_only and ranked.occurred_at>=prefs.reset_at
)
select left(concat_ws(' | ','Explicit interests: '||(select value from interests),'Positive activity: '||(select value from positive)),12000)
$$;

create or replace function public.queue_embedding_regeneration_v1(target_scope text default 'all')
returns integer language plpgsql security definer set search_path=public as $$
declare changed integer:=0;step_count integer;
begin
  if target_scope not in ('all','content','user') then raise exception 'invalid embedding regeneration scope'; end if;
  if target_scope in ('all','content') then
    insert into public.embedding_jobs(target_type,content_kind,content_id,source_hash)
    select 'content','event',e.id,md5(coalesce(concat_ws(' | ',e.title,e.category,array_to_string(e.tags,' '),e.summary,e.description),'')) from public.events e
    where e.status in ('published','scheduled')
    on conflict do nothing;
    get diagnostics step_count=row_count;changed:=changed+step_count;
    insert into public.embedding_jobs(target_type,content_kind,content_id,source_hash)
    select 'content','place',l.id,md5(coalesce(concat_ws(' | ',l.name,l.kind,array_to_string(l.tags,' '),l.summary,l.description,array_to_string(l.amenities,' ')),'')) from public.locations l
    where l.status='published'
    on conflict do nothing;
    get diagnostics step_count=row_count;changed:=changed+step_count;
  end if;
  if target_scope in ('all','user') then
    insert into public.embedding_jobs(target_type,profile_id,source_hash)
    select 'user',p.id,md5(public.recommendation_preference_text_v1(p.id)) from public.profiles p
    where nullif(trim(public.recommendation_preference_text_v1(p.id)),'') is not null
    on conflict do nothing;
    get diagnostics step_count=row_count;changed:=changed+step_count;
  end if;
  return changed;
end;
$$;

create or replace function public.queue_preference_embedding_v1()
returns trigger language plpgsql security definer set search_path=public as $$
declare actor uuid;hash_value text;existing_job bigint;payload jsonb;
begin
  if tg_op='DELETE' then payload:=to_jsonb(old); else payload:=to_jsonb(new); end if;
  actor:=coalesce(nullif(payload->>'profile_id','')::uuid,nullif(payload->>'owner_id','')::uuid,nullif(payload->>'id','')::uuid);
  if actor is null then if tg_op='DELETE' then return old; else return new; end if; end if;
  hash_value:=md5(actor::text||':'||clock_timestamp()::text);
  update public.user_preference_embeddings set active=false,stale_at=coalesce(stale_at,now()) where profile_id=actor and active;
  select id into existing_job from public.embedding_jobs where target_type='user' and profile_id=actor and status in ('queued','processing') order by id desc limit 1 for update;
  if existing_job is null then insert into public.embedding_jobs(target_type,profile_id,source_hash) values('user',actor,hash_value);
  else update public.embedding_jobs set source_hash=hash_value,status='queued',next_attempt_at=now(),locked_at=null,error_category=null,updated_at=now() where id=existing_job; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists discovery_actions_queue_preference on public.discovery_actions;
create trigger discovery_actions_queue_preference after insert or update of action,undone_at on public.discovery_actions for each row execute function public.queue_preference_embedding_v1();
drop trigger if exists user_content_states_queue_preference on public.user_content_states;
create trigger user_content_states_queue_preference after insert or delete or update on public.user_content_states for each row execute function public.queue_preference_embedding_v1();
drop trigger if exists event_rsvps_queue_preference on public.event_rsvps;
create trigger event_rsvps_queue_preference after insert or delete or update of status on public.event_rsvps for each row execute function public.queue_preference_embedding_v1();
drop trigger if exists location_visits_queue_preference on public.location_visits;
create trigger location_visits_queue_preference after insert or delete or update of status on public.location_visits for each row execute function public.queue_preference_embedding_v1();
drop trigger if exists host_follows_queue_preference on public.host_follows;
create trigger host_follows_queue_preference after insert or delete on public.host_follows for each row execute function public.queue_preference_embedding_v1();
drop trigger if exists tickets_queue_preference on public.tickets;
create trigger tickets_queue_preference after insert or delete or update of status on public.tickets for each row execute function public.queue_preference_embedding_v1();
drop trigger if exists profiles_interests_queue_preference on public.profiles;
create trigger profiles_interests_queue_preference after update of interests on public.profiles for each row execute function public.queue_preference_embedding_v1();
drop trigger if exists event_swipes_queue_preference on public.event_swipes;
create trigger event_swipes_queue_preference after insert or delete or update of direction on public.event_swipes for each row execute function public.queue_preference_embedding_v1();
drop trigger if exists event_saves_queue_preference on public.event_saves;
create trigger event_saves_queue_preference after insert or delete on public.event_saves for each row execute function public.queue_preference_embedding_v1();
