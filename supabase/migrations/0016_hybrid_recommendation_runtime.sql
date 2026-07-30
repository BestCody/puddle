-- Stage 8C: embedding workers, hybrid candidate generation, outcomes, and user controls.
-- Apply after 0015_hybrid_recommendation_foundation.sql.

create or replace function public.claim_embedding_jobs_v1(batch_size integer default 25)
returns table(job_id bigint,target_type text,content_kind text,content_id uuid,profile_id uuid,source_hash text,source_text text)
language plpgsql security definer set search_path=public as $$
begin
  update public.embedding_jobs set status='queued',locked_at=null,next_attempt_at=now(),updated_at=now() where status='processing' and locked_at<now()-interval '15 minutes';
  return query
  with claimed as (
    select j.id from public.embedding_jobs j where j.status in ('queued','failed') and j.next_attempt_at<=now() and j.attempts<8
    order by j.created_at limit greatest(1,least(batch_size,100)) for update skip locked
  ),updated as (
    update public.embedding_jobs j set status='processing',attempts=j.attempts+1,locked_at=now(),updated_at=now()
    from claimed c where j.id=c.id returning j.*
  )
  select u.id,u.target_type,u.content_kind,u.content_id,u.profile_id,u.source_hash,
    case when u.target_type='user' then public.recommendation_preference_text_v1(u.profile_id)
      when u.content_kind='event' then (select left(concat_ws(' | ',e.title,e.category,array_to_string(e.tags,' '),e.summary,e.description),12000) from public.events e where e.id=u.content_id)
      else (select left(concat_ws(' | ',l.name,l.kind,array_to_string(l.tags,' '),l.summary,l.description,array_to_string(l.amenities,' ')),12000) from public.locations l where l.id=u.content_id)
    end
  from updated u;
end;
$$;

create or replace function public.store_embedding_job_v1(target_job bigint,embedding_text text,model_name text,model_revision text,embedding_dimensions integer default 768)
returns void language plpgsql security definer set search_path=public as $$
declare job public.embedding_jobs%rowtype;value extensions.vector(768);
begin
  select * into job from public.embedding_jobs where id=target_job and status='processing' for update;
  if job.id is null then raise exception 'embedding job unavailable'; end if;
  if embedding_dimensions<>768 then raise exception 'embedding dimensions must be 768'; end if;
  value:=embedding_text::extensions.vector;
  if extensions.vector_dims(value)<>768 then raise exception 'embedding vector has wrong dimensions'; end if;
  if job.target_type='content' then
    update public.content_embeddings set active=false,stale_at=coalesce(stale_at,now()) where content_kind=job.content_kind and content_id=job.content_id and model=model_name and model_version=model_revision and active;
    insert into public.content_embeddings(content_kind,content_id,embedding,model,model_version,dimensions,normalization,source_hash,active)
    values(job.content_kind,job.content_id,value,left(model_name,160),left(model_revision,160),768,'l2',job.source_hash,true)
    on conflict(content_kind,content_id,model,model_version,source_hash) do update set embedding=excluded.embedding,active=true,generated_at=now(),stale_at=null,deleted_at=null;
  else
    update public.user_preference_embeddings set active=false,stale_at=coalesce(stale_at,now()) where profile_id=job.profile_id and model=model_name and model_version=model_revision and active;
    insert into public.user_preference_embeddings(profile_id,embedding,model,model_version,dimensions,normalization,source_hash,active)
    values(job.profile_id,value,left(model_name,160),left(model_revision,160),768,'l2',job.source_hash,true)
    on conflict(profile_id,model,model_version,source_hash) do update set embedding=excluded.embedding,active=true,generated_at=now(),stale_at=null,deleted_at=null;
  end if;
  update public.embedding_jobs set status='done',finished_at=now(),locked_at=null,error_category=null,updated_at=now() where id=target_job;
end;
$$;

create or replace function public.fail_embedding_job_v1(target_job bigint,failure_category text,retry_after_seconds integer default 300)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.embedding_jobs set status=case when attempts>=8 then 'failed' else 'queued' end,
    error_category=left(failure_category,160),next_attempt_at=now()+make_interval(secs=>greatest(30,least(retry_after_seconds,86400))),locked_at=null,updated_at=now()
  where id=target_job and status='processing';
end;
$$;

select public.queue_embedding_regeneration_v1('all');

create or replace function public.recommendation_candidate_pool_v1(user_lat double precision default null,user_lng double precision default null,radius_m integer default 25000,max_rows integer default 300)
returns table(
  content_kind text,content_id uuid,slug text,title text,summary text,category text,starts_at timestamptz,ends_at timestamptz,timezone text,
  price_cents integer,price_level smallint,min_age smallint,capacity integer,remaining_capacity integer,accessibility jsonb,amenities text[],opening_hours jsonb,
  latitude double precision,longitude double precision,distance_m double precision,cover_path text,host_id uuid,host_name text,host_verified boolean,published_at timestamptz,
  popularity_score real,friend_score real,vector_similarity real,embedding_model_version text,candidate_sources text[]
) language sql stable security definer set search_path=public,extensions as $$
with actor as (select auth.uid() id),profile as (select p.* from public.profiles p join actor a on a.id=p.id),
prefs as (select coalesce(r.vector_enabled,true) vector_enabled,coalesce(r.friend_activity_enabled,true) friend_enabled from actor a left join public.recommendation_preferences r on r.profile_id=a.id),
origin as (select case when user_lat is null or user_lng is null then null else st_setsrid(st_makepoint(user_lng,user_lat),4326)::geography end point),
friends as (
  select case when f.requester_id=(select id from actor) then f.addressee_id else f.requester_id end friend_id from public.friendships f
  where f.state='accepted' and (f.requester_id=(select id from actor) or f.addressee_id=(select id from actor))
    and not exists(select 1 from public.blocks b where (b.blocker_id=(select id from actor) and b.blocked_id=case when f.requester_id=(select id from actor) then f.addressee_id else f.requester_id end) or (b.blocked_id=(select id from actor) and b.blocker_id=case when f.requester_id=(select id from actor) then f.addressee_id else f.requester_id end))
),ue as (
  select u.* from public.user_preference_embeddings u,prefs where u.profile_id=(select id from actor) and u.active and u.deleted_at is null and prefs.vector_enabled and public.feature_enabled_v1('vector_recommendations_enabled') order by u.generated_at desc limit 1
),vector_candidates as (
  select c.content_kind,c.content_id from public.content_embeddings c cross join ue
  where c.active and c.deleted_at is null and c.model=ue.model and c.model_version=ue.model_version
  order by c.embedding <=> ue.embedding limit 250
),event_rows as (
  select 'event'::text,e.id,e.slug,e.title,e.summary,e.category,e.starts_at,e.ends_at,e.timezone,e.price_from_cents,null::smallint,e.min_age,e.capacity,
    case when e.capacity is null then null else greatest(0,e.capacity-coalesce(stats.going_count,0)) end,
    coalesce(e.accessibility,'{}'::jsonb),'{}'::text[],'{}'::jsonb,
    case when coalesce(l.has_private_address,false) then null else l.latitude end,case when coalesce(l.has_private_address,false) then null else l.longitude end,
    case when o.point is null or l.point is null or coalesce(l.has_private_address,false) then null else st_distance(l.point,o.point) end,e.cover_path,e.host_profile_id,h.name,coalesce(h.verification_status='verified',false),e.published_at,
    least(1.0,ln(1+coalesce(stats.engagement,0))/8.0)::real,
    least(1.0,coalesce(friend_stats.engagement,0)/5.0)::real,
    case when ce.embedding is null or ue.embedding is null then null else greatest(0.0,least(1.0,1-(ce.embedding <=> ue.embedding)))::real end,
    ce.model_version,
    array_remove(array[
      case when o.point is not null and l.point is not null and not coalesce(l.has_private_address,false) then 'proximity' end,
      case when e.starts_at<now()+interval '7 days' then 'upcoming' end,
      case when e.category=any(coalesce((select interests from profile),'{}'::text[])) then 'explicit_interest' end,
      case when e.host_profile_id is not null and exists(select 1 from public.host_follows hf where hf.profile_id=(select id from actor) and hf.host_profile_id=e.host_profile_id) then 'followed_host' end,
      case when coalesce(friend_stats.engagement,0)>0 then 'friend_activity' end,
      case when coalesce(stats.engagement,0)>0 then 'popularity' end,
      case when vc.content_id is not null and ce.embedding is not null and ue.embedding is not null then 'vector_nearest' end
    ],null)::text[]
  from public.events e left join public.locations l on l.id=e.location_id left join public.host_profiles h on h.id=e.host_profile_id cross join origin o cross join prefs left join ue on true
  left join lateral (
    select count(*) filter(where r.status in ('going','checked_in'))::integer going_count,
      (count(*) filter(where r.status in ('going','checked_in'))*3 + count(*) filter(where r.status in ('interested','requested')) +
       (select count(*)*2 from public.discovery_actions d where d.event_id=e.id and d.undone_at is null and d.action in ('saved','interested','visited')) +
       (select count(*)*5 from public.tickets t join public.ticket_types tt on tt.id=t.ticket_type_id where tt.event_id=e.id and t.status in ('valid','checked_in')))::numeric engagement
    from public.event_rsvps r where r.event_id=e.id
  ) stats on true
  left join lateral (
    select count(*)::numeric engagement from public.discovery_actions d join friends f on f.friend_id=d.profile_id join public.profiles fp on fp.id=f.friend_id
    where (fp.activity_visibility in ('friends','public') or (fp.activity_visibility='close_friends' and exists(select 1 from public.friend_close_friends cf where cf.profile_id=fp.id and cf.friend_id=(select id from actor)))) and d.event_id=e.id and d.undone_at is null and d.action in ('saved','interested','visited') and d.created_at>now()-interval '60 days' and prefs.friend_enabled
  ) friend_stats on true
  left join vector_candidates vc on vc.content_kind='event' and vc.content_id=e.id
  left join lateral (
    select c.embedding,c.model_version from public.content_embeddings c where c.content_kind='event' and c.content_id=e.id and c.active and c.deleted_at is null and c.model=ue.model and c.model_version=ue.model_version order by c.generated_at desc limit 1
  ) ce on true
  where e.status='published' and e.visibility='public' and e.ends_at>now()
    and (e.min_age is null or ((select birth_date from profile) is not null and (select birth_date from profile)<=current_date-make_interval(years=>e.min_age)))
    and not exists(select 1 from public.blocks b where (b.blocker_id=(select id from actor) and b.blocked_id=e.created_by) or (b.blocked_id=(select id from actor) and b.blocker_id=e.created_by))
    and (o.point is null or l.point is null or coalesce(l.has_private_address,false) or st_dwithin(l.point,o.point,greatest(1000,least(radius_m,200000))))
    and (select id from actor) is not null
),place_rows as (
  select 'place'::text,l.id,l.slug,l.name,l.summary,l.kind,null::timestamptz,null::timestamptz,l.timezone,null::integer,l.price_level,null::smallint,null::integer,null::integer,
    coalesce(l.accessibility,'{}'::jsonb),coalesce(l.amenities,'{}'::text[]),coalesce(l.opening_hours,'{}'::jsonb),l.latitude,l.longitude,
    case when o.point is null or l.point is null then null else st_distance(l.point,o.point) end,l.cover_path,l.host_profile_id,h.name,coalesce(h.verification_status='verified',false),coalesce(l.published_at,l.updated_at),
    least(1.0,ln(1+coalesce(stats.engagement,0))/8.0)::real,
    least(1.0,coalesce(friend_stats.engagement,0)/5.0)::real,
    case when ce.embedding is null or ue.embedding is null then null else greatest(0.0,least(1.0,1-(ce.embedding <=> ue.embedding)))::real end,
    ce.model_version,
    array_remove(array[
      case when o.point is not null and l.point is not null and not coalesce(l.has_private_address,false) then 'proximity' end,
      case when l.kind=any(coalesce((select interests from profile),'{}'::text[])) then 'explicit_interest' end,
      case when l.host_profile_id is not null and exists(select 1 from public.host_follows hf where hf.profile_id=(select id from actor) and hf.host_profile_id=l.host_profile_id) then 'followed_host' end,
      case when coalesce(friend_stats.engagement,0)>0 then 'friend_activity' end,
      case when coalesce(stats.engagement,0)>0 then 'popularity' end,
      case when vc.content_id is not null and ce.embedding is not null and ue.embedding is not null then 'vector_nearest' end
    ],null)::text[]
  from public.locations l left join public.host_profiles h on h.id=l.host_profile_id cross join origin o cross join prefs left join ue on true
  left join lateral (
    select ((select count(*)*3 from public.location_visits v where v.location_id=l.id and v.status='visited') +
      (select count(*)*2 from public.discovery_actions d where d.location_id=l.id and d.undone_at is null and d.action in ('saved','interested','visited')))::numeric engagement
  ) stats on true
  left join lateral (
    select count(*)::numeric engagement from public.discovery_actions d join friends f on f.friend_id=d.profile_id join public.profiles fp on fp.id=f.friend_id
    where (fp.activity_visibility in ('friends','public') or (fp.activity_visibility='close_friends' and exists(select 1 from public.friend_close_friends cf where cf.profile_id=fp.id and cf.friend_id=(select id from actor)))) and d.location_id=l.id and d.undone_at is null and d.action in ('saved','interested','visited') and d.created_at>now()-interval '60 days' and prefs.friend_enabled
  ) friend_stats on true
  left join vector_candidates vc on vc.content_kind='place' and vc.content_id=l.id
  left join lateral (
    select c.embedding,c.model_version from public.content_embeddings c where c.content_kind='place' and c.content_id=l.id and c.active and c.deleted_at is null and c.model=ue.model and c.model_version=ue.model_version order by c.generated_at desc limit 1
  ) ce on true
  where l.status='published' and l.visibility='public' and not coalesce(l.has_private_address,false)
    and not exists(select 1 from public.blocks b where (b.blocker_id=(select id from actor) and b.blocked_id=l.created_by) or (b.blocked_id=(select id from actor) and b.blocker_id=l.created_by))
    and (o.point is null or l.point is null or st_dwithin(l.point,o.point,greatest(1000,least(radius_m,200000))))
    and (select id from actor) is not null
)
select * from (select * from event_rows union all select * from place_rows) pool
order by 28 desc nulls last,20 nulls last,25 desc nulls last limit greatest(1,least(max_rows,500));
$$;

create or replace function public.record_recommendation_outcome_v1(request_key uuid,target_kind text,target_id uuid,outcome_name text,outcome_metadata jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();request_owner uuid;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if target_kind not in ('event','place') or outcome_name not in ('impression','opened','saved','dismissed','interested','rsvp','ticket_purchase','visited','followed_host','undo','report','block') then raise exception 'invalid recommendation outcome'; end if;
  if request_key is not null then select profile_id into request_owner from public.recommendation_requests where request_id=request_key; if request_owner is distinct from actor then raise exception 'recommendation request unavailable'; end if; end if;
  insert into public.recommendation_outcomes(request_id,profile_id,content_kind,event_id,location_id,outcome,metadata)
  values(request_key,actor,target_kind,case when target_kind='event' then target_id end,case when target_kind='place' then target_id end,outcome_name,coalesce(outcome_metadata,'{}'::jsonb))
  on conflict do nothing;
  return found;
end;
$$;

create or replace function public.capture_operational_recommendation_outcome_v1()
returns trigger language plpgsql security definer set search_path=public as $$
declare actor uuid;kind text;target uuid;outcome_name text;
begin
  if tg_table_name='event_rsvps' then
    actor:=new.profile_id;kind:='event';target:=new.event_id;
    outcome_name:=case when new.status='checked_in' then 'visited' when new.status in ('going','requested','interested') then 'rsvp' end;
  elsif tg_table_name='tickets' then
    actor:=new.owner_id;kind:='event';
    select tt.event_id into target from public.ticket_types tt where tt.id=new.ticket_type_id;
    if new.status in ('valid','checked_in') then outcome_name:='ticket_purchase'; end if;
  elsif tg_table_name='location_visits' then
    actor:=new.profile_id;kind:='place';target:=new.location_id;
    if new.status='visited' then outcome_name:='visited'; end if;
  elsif tg_table_name='event_saves' then
    actor:=new.profile_id;kind:='event';target:=new.event_id;outcome_name:='saved';
  elsif tg_table_name='event_swipes' then
    actor:=new.profile_id;kind:='event';target:=new.event_id;
    outcome_name:=case when new.direction in ('right','more_like_this') then 'interested' else 'dismissed' end;
  end if;
  if actor is not null and target is not null and outcome_name is not null then
    insert into public.recommendation_outcomes(profile_id,content_kind,event_id,location_id,outcome,metadata)
    values(actor,kind,case when kind='event' then target end,case when kind='place' then target end,outcome_name,jsonb_build_object('source','operational_record'));
  end if;
  return new;
end;
$$;
drop trigger if exists event_rsvps_capture_recommendation_outcome on public.event_rsvps;
create trigger event_rsvps_capture_recommendation_outcome after insert or update of status on public.event_rsvps for each row when (new.status in ('interested','requested','going','checked_in')) execute function public.capture_operational_recommendation_outcome_v1();
drop trigger if exists tickets_capture_recommendation_outcome on public.tickets;
create trigger tickets_capture_recommendation_outcome after insert or update of status on public.tickets for each row when (new.status in ('valid','checked_in')) execute function public.capture_operational_recommendation_outcome_v1();
drop trigger if exists location_visits_capture_recommendation_outcome on public.location_visits;
create trigger location_visits_capture_recommendation_outcome after insert or update of status on public.location_visits for each row when (new.status='visited') execute function public.capture_operational_recommendation_outcome_v1();
drop trigger if exists event_saves_capture_recommendation_outcome on public.event_saves;
create trigger event_saves_capture_recommendation_outcome after insert on public.event_saves for each row execute function public.capture_operational_recommendation_outcome_v1();
drop trigger if exists event_swipes_capture_recommendation_outcome on public.event_swipes;
create trigger event_swipes_capture_recommendation_outcome after insert or update of direction on public.event_swipes for each row execute function public.capture_operational_recommendation_outcome_v1();

create or replace function public.save_recommendation_preferences_v1(
  behavioral boolean default true,
  friend_activity boolean default true,
  vector_similarity boolean default true,
  interests_only boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();changed boolean:=true;prior public.recommendation_preferences%rowtype;
begin
  if actor is null then raise exception 'authentication required'; end if;
  select * into prior from public.recommendation_preferences where profile_id=actor;
  if prior.profile_id is not null then changed:=prior.behavioral_enabled is distinct from behavioral or prior.explicit_interests_only is distinct from interests_only; end if;
  insert into public.recommendation_preferences(profile_id,behavioral_enabled,friend_activity_enabled,vector_enabled,explicit_interests_only,behavioral_reset_at,updated_at)
  values(actor,behavioral,friend_activity,vector_similarity,interests_only,case when interests_only then now() else '-infinity'::timestamptz end,now())
  on conflict(profile_id) do update set behavioral_enabled=excluded.behavioral_enabled,friend_activity_enabled=excluded.friend_activity_enabled,
    vector_enabled=excluded.vector_enabled,explicit_interests_only=excluded.explicit_interests_only,
    behavioral_reset_at=case when changed then now() else recommendation_preferences.behavioral_reset_at end,updated_at=now();
  if changed then
    update public.user_preference_embeddings set active=false,stale_at=coalesce(stale_at,now()) where profile_id=actor and active;
    delete from public.embedding_jobs where target_type='user' and profile_id=actor and status in ('queued','processing','failed');
    insert into public.embedding_jobs(target_type,profile_id,source_hash) values('user',actor,md5(actor::text||':'||clock_timestamp()::text));
  end if;
  return (select to_jsonb(r) from public.recommendation_preferences r where r.profile_id=actor);
end;
$$;

create or replace function public.reset_recommendation_preferences_v1()
returns void language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();
begin
  if actor is null then raise exception 'authentication required'; end if;
  insert into public.recommendation_preferences(profile_id,behavioral_enabled,friend_activity_enabled,vector_enabled,explicit_interests_only,behavioral_reset_at,updated_at)
  values(actor,true,true,true,false,now(),now())
  on conflict(profile_id) do update set behavioral_enabled=true,friend_activity_enabled=true,vector_enabled=true,explicit_interests_only=false,behavioral_reset_at=now(),updated_at=now();
  update public.user_preference_embeddings set active=false,deleted_at=now() where profile_id=actor and deleted_at is null;
  delete from public.embedding_jobs where target_type='user' and profile_id=actor;
  delete from public.recommendation_assignments where profile_id=actor;
  insert into public.embedding_jobs(target_type,profile_id,source_hash) values('user',actor,md5(actor::text||':'||clock_timestamp()::text));
end;
$$;

create or replace function public.delete_recommendation_data_v1()
returns void language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();
begin
  if actor is null then raise exception 'authentication required'; end if;
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
