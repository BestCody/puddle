begin;

-- Global catalogue data lives in B2 and OpenSearch. Supabase keeps only lazy IDs
-- for locations that have relational product state.
create table if not exists public.location_refs (
  id uuid primary key,
  kind text not null default 'global' check (kind in ('global','puddle_native')),
  created_at timestamptz not null default now()
);
alter table public.location_refs enable row level security;
revoke all on table public.location_refs from anon, authenticated;
grant select,insert,update,delete on table public.location_refs to service_role;

-- Puddle-authored places remain workflow state only until canonical ingestion.
create table if not exists public.location_submissions (like public.locations including all);
alter table public.location_submissions enable row level security;
revoke all on table public.location_submissions from anon;
grant select,insert,update,delete on table public.location_submissions to authenticated;
grant all on table public.location_submissions to service_role;

drop policy if exists "location submission read" on public.location_submissions;
create policy "location submission read" on public.location_submissions for select to authenticated using (
  created_by=(select auth.uid())
  or (host_profile_id is not null and public.is_host_member(host_profile_id))
  or public.is_admin()
);
drop policy if exists "location submission create" on public.location_submissions;
create policy "location submission create" on public.location_submissions for insert to authenticated with check (
  created_by=(select auth.uid())
  and (public.puddle_tinder_active_v1((select auth.uid())) or public.is_admin())
  and (host_profile_id is null or public.has_host_role(host_profile_id,array['owner','editor']))
);
drop policy if exists "location submission update" on public.location_submissions;
create policy "location submission update" on public.location_submissions for update to authenticated using (
  created_by=(select auth.uid())
  or (host_profile_id is not null and public.has_host_role(host_profile_id,array['owner','editor']))
  or public.is_admin()
) with check (
  created_by=(select auth.uid())
  or (host_profile_id is not null and public.has_host_role(host_profile_id,array['owner','editor']))
  or public.is_admin()
);
drop policy if exists "location submission moderation gate" on public.location_submissions;
create policy "location submission moderation gate" on public.location_submissions as restrictive for all to authenticated
using (not public.is_moderated_profile_v1()) with check (not public.is_moderated_profile_v1());

-- A submission itself is enough reason to allocate its tiny relational ID.
create or replace function public.ensure_location_submission_ref_v1()
returns trigger language plpgsql security definer set search_path='public' as $$
begin
  insert into public.location_refs(id,kind) values(new.id,'puddle_native')
  on conflict(id) do update set kind='puddle_native';
  return new;
end;
$$;
revoke all on function public.ensure_location_submission_ref_v1() from public,anon,authenticated;

drop trigger if exists location_submissions_ensure_ref on public.location_submissions;
create trigger location_submissions_ensure_ref after insert on public.location_submissions
for each row execute function public.ensure_location_submission_ref_v1();

-- All old rows that reference imported/seed catalogue rows are disposable test data.
-- Delete only rows with a place FK; unrelated account/profile data remains intact.
do $$
declare r record;
begin
  for r in
    select distinct tc.table_schema,tc.table_name,kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_schema=tc.constraint_schema and kcu.constraint_name=tc.constraint_name
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_schema=tc.constraint_schema and ccu.constraint_name=tc.constraint_name
    where tc.constraint_type='FOREIGN KEY'
      and ccu.table_schema='public' and ccu.table_name='locations' and ccu.column_name='id'
      and tc.table_schema='public'
      and tc.table_name not in (
        'locations','catalogue_region_locations','google_place_geocode_attempts','google_place_id_candidates',
        'google_place_match_attempts','location_descriptions','location_google_places','location_photo_sources',
        'location_source_links','location_private_details','location_revisions'
      )
  loop
    execute format('delete from %I.%I where %I is not null',r.table_schema,r.table_name,r.column_name);
  end loop;
end $$;

delete from public.location_private_details;
delete from public.location_revisions;

-- Completed/legacy catalogue and enrichment state. Canonical equivalents are in B2/OpenSearch.
drop view if exists public.location_card_quality_v1;
drop table if exists public.catalogue_region_locations cascade;
drop table if exists public.catalogue_sync_regions cascade;
drop table if exists public.google_place_geocode_attempts cascade;
drop table if exists public.google_place_id_candidates cascade;
drop table if exists public.google_place_match_attempts cascade;
drop table if exists public.location_descriptions cascade;
drop table if exists public.location_google_places cascade;
drop table if exists public.location_photo_sources cascade;
drop table if exists public.location_source_links cascade;
drop table if exists public.location_photo_b2_migration_audit cascade;

-- Submission-only support tables point at the authoring workflow, not the global catalogue.
alter table public.location_private_details drop constraint if exists location_private_details_location_id_fkey;
alter table public.location_private_details add constraint location_private_details_location_id_fkey
  foreign key(location_id) references public.location_submissions(id) on delete cascade;
alter table public.location_revisions drop constraint if exists location_revisions_location_id_fkey;
alter table public.location_revisions add constraint location_revisions_location_id_fkey
  foreign key(location_id) references public.location_submissions(id) on delete cascade;

-- Every surviving relational product FK is redirected to the lazy registry.
do $$
declare r record; delete_clause text;
begin
  for r in
    select tc.table_schema,tc.table_name,tc.constraint_name,kcu.column_name,rc.delete_rule
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_schema=tc.constraint_schema and kcu.constraint_name=tc.constraint_name
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_schema=tc.constraint_schema and ccu.constraint_name=tc.constraint_name
    join information_schema.referential_constraints rc
      on rc.constraint_schema=tc.constraint_schema and rc.constraint_name=tc.constraint_name
    where tc.constraint_type='FOREIGN KEY'
      and ccu.table_schema='public' and ccu.table_name='locations' and ccu.column_name='id'
      and tc.table_schema='public'
      and tc.table_name not in ('locations','location_private_details','location_revisions')
  loop
    delete_clause:=case r.delete_rule when 'CASCADE' then ' cascade' when 'SET NULL' then ' set null' when 'SET DEFAULT' then ' set default' else ' no action' end;
    execute format('alter table %I.%I drop constraint %I',r.table_schema,r.table_name,r.constraint_name);
    execute format('alter table %I.%I add constraint %I foreign key(%I) references public.location_refs(id) on delete%s',
      r.table_schema,r.table_name,r.constraint_name,r.column_name,delete_clause);
  end loop;
end $$;

-- Authoring functions now operate only on submission workflow state.
create or replace function public.can_manage_location(target uuid)
returns boolean language sql stable security definer set search_path='public' as $$
  select exists(
    select 1 from public.location_submissions l where l.id=target and (
      l.created_by=(select auth.uid())
      or (l.host_profile_id is not null and public.has_host_role(l.host_profile_id,array['owner','editor']))
      or (l.claimed_by_host_id is not null and public.has_host_role(l.claimed_by_host_id,array['owner','editor']))
      or public.is_admin()
    )
  )
$$;
revoke all on function public.can_manage_location(uuid) from public,anon;
grant execute on function public.can_manage_location(uuid) to authenticated,service_role;

create or replace function public.request_location_publication(target uuid)
returns text language plpgsql security definer set search_path='public' as $$
declare record_location public.location_submissions%rowtype;
begin
  if not public.can_manage_location(target) then raise exception 'Not authorized to submit this location'; end if;
  select * into record_location from public.location_submissions where id=target for update;
  if record_location.status not in ('draft','rejected') then raise exception 'This location cannot enter review from its current status'; end if;
  if record_location.name is null or record_location.city is null or (
    record_location.address_public is null and not exists(
      select 1 from public.location_private_details d where d.location_id=record_location.id and nullif(trim(coalesce(d.exact_address,'')),'') is not null
    )
  ) then raise exception 'Complete the required location details'; end if;
  perform set_config('puddle.allow_status_transition','on',true);
  perform set_config('puddle.change_source','publication',true);
  update public.location_submissions set status='pending_review',submitted_at=now(),status_reason=null where id=target;
  return 'pending_review';
end
$$;
revoke all on function public.request_location_publication(uuid) from public,anon;
grant execute on function public.request_location_publication(uuid) to authenticated,service_role;

create or replace function public.transition_location_status(target uuid,next_status text,transition_note text default null)
returns text language plpgsql security definer set search_path='public' as $$
declare current_state text; allowed boolean:=false;
begin
  if not public.can_manage_location(target) then raise exception 'Not authorized to manage this location'; end if;
  select status into current_state from public.location_submissions where id=target for update;
  if next_status='published' then raise exception 'Canonical B2/OpenSearch ingestion is required before publication'; end if;
  allowed := (current_state='draft' and next_status in ('pending_review','archived'))
    or (current_state='pending_review' and next_status in ('draft','rejected','suspended','archived'))
    or (current_state in ('rejected','suspended') and next_status in ('draft','archived'));
  if not allowed then raise exception 'Invalid location status transition'; end if;
  if next_status in ('rejected','suspended') and not public.is_admin() then raise exception 'A moderator must review this transition'; end if;
  perform set_config('puddle.allow_status_transition','on',true);
  perform set_config('puddle.change_source','status',true);
  perform set_config('puddle.change_note',coalesce(transition_note,''),true);
  update public.location_submissions set status=next_status,status_reason=transition_note,
    archived_at=case when next_status='archived' then now() else archived_at end where id=target;
  return next_status;
end
$$;
revoke all on function public.transition_location_status(uuid,text,text) from public,anon;
grant execute on function public.transition_location_status(uuid,text,text) to authenticated,service_role;

-- Attach the useful authoring triggers to the submission table. Catalogue-only triggers are not copied.
drop trigger if exists location_submissions_capture_revision on public.location_submissions;
create trigger location_submissions_capture_revision after insert or update on public.location_submissions
for each row execute function public.capture_location_revision();
drop trigger if exists location_submissions_guard_publication_fields on public.location_submissions;
create trigger location_submissions_guard_publication_fields before update on public.location_submissions
for each row execute function public.guard_location_publication_fields();
drop trigger if exists location_submissions_touch_updated_at on public.location_submissions;
create trigger location_submissions_touch_updated_at before update on public.location_submissions
for each row execute function public.touch_stage_one_updated_at();
drop trigger if exists location_submissions_sync_point on public.location_submissions;
create trigger location_submissions_sync_point before insert or update on public.location_submissions
for each row execute function public.sync_location_point();

-- Saved/planned/history RPCs return relationship state only. Vercel hydrates IDs from OpenSearch.
create or replace function public.location_saved_page_v1(
  before_pinned boolean default null,before_sort_at timestamptz default null,before_location_id uuid default null,
  result_limit integer default 25,category_filter text default null,search_term text default null
) returns table(location_id uuid,name text,slug text,summary text,kind text,city text,cover_path text,saved_at timestamptz,pinned_at timestamptz,perfect_pick boolean,cursor_pinned boolean,cursor_at timestamptz,cursor_id uuid)
language sql stable security definer set search_path='public' as $$
  select s.location_id,null::text,null::text,null::text,null::text,null::text,null::text,
    s.created_at,s.pinned_at,
    exists(select 1 from public.discovery_context_outbox o where o.profile_id=(select auth.uid()) and o.location_id=s.location_id and o.event_name='perfect'),
    (s.pinned_at is not null),coalesce(s.pinned_at,s.created_at),s.location_id
  from public.user_content_states s
  where s.profile_id=(select auth.uid()) and s.state='saved' and s.location_id is not null
    and (before_sort_at is null or ((s.pinned_at is not null),coalesce(s.pinned_at,s.created_at),s.location_id)<(coalesce(before_pinned,false),before_sort_at,before_location_id))
  order by (s.pinned_at is not null) desc,coalesce(s.pinned_at,s.created_at) desc,s.location_id desc
  limit greatest(1,least(coalesce(result_limit,25),41))
$$;

create or replace function public.location_planned_page_v1(after_sort_at timestamptz default null,after_location_id uuid default null,result_limit integer default 25)
returns table(location_id uuid,name text,slug text,summary text,kind text,city text,cover_path text,planned_for timestamptz,plan_source text,participants text[],cursor_at timestamptz,cursor_id uuid)
language sql stable security definer set search_path='public' as $$
  select v.location_id,null::text,null::text,null::text,null::text,null::text,null::text,v.planned_for,
    'personal'::text,array['You']::text[],coalesce(v.planned_for,v.created_at),v.location_id
  from public.location_visits v
  where v.profile_id=(select auth.uid()) and v.status='planned'
    and (after_sort_at is null or (coalesce(v.planned_for,v.created_at),v.location_id)>(after_sort_at,after_location_id))
  order by coalesce(v.planned_for,v.created_at),v.location_id
  limit greatest(1,least(coalesce(result_limit,25),41))
$$;

create or replace function public.location_history_page_v1(before_sort_at timestamptz default null,before_location_id uuid default null,result_limit integer default 25)
returns table(location_id uuid,name text,slug text,summary text,kind text,city text,cover_path text,visited_at timestamptz,visit_source text,participants text[],cursor_at timestamptz,cursor_id uuid)
language sql stable security definer set search_path='public' as $$
  with combined as (
    select s.location_id,s.created_at visited_at,'personal'::text visit_source,array['You']::text[] participants,s.created_at sort_at
    from public.user_content_states s where s.profile_id=(select auth.uid()) and s.state='visited' and s.location_id is not null
    union all
    select v.location_id,coalesce(v.visited_at,v.created_at),'personal'::text,array['You']::text[],coalesce(v.visited_at,v.created_at)
    from public.location_visits v where v.profile_id=(select auth.uid()) and v.status='visited'
  ), deduped as (
    select *,row_number() over(partition by location_id order by sort_at desc,location_id desc) duplicate_rank from combined
  )
  select location_id,null::text,null::text,null::text,null::text,null::text,null::text,
    visited_at,visit_source,participants,sort_at,location_id
  from deduped where duplicate_rank=1
    and (before_sort_at is null or (sort_at,location_id)<(before_sort_at,before_location_id))
  order by sort_at desc,location_id desc
  limit greatest(1,least(coalesce(result_limit,25),41))
$$;

create or replace function public.discovery_seen_locations_v1()
returns table(id uuid,duplicate_group_key text,catalogue_group_key text,name text,latitude double precision,longitude double precision)
language sql stable security definer set search_path='public' as $$
  with latest_swipe as (
    select distinct on (a.location_id) a.location_id,a.undone_at from public.discovery_actions a
    where a.profile_id=(select auth.uid()) and a.location_id is not null and a.action in ('saved','interested','dismissed','visited')
    order by a.location_id,a.id desc
  ), seen as (
    select location_id from latest_swipe where undone_at is null
    union
    select s.location_id from public.user_content_states s where s.profile_id=(select auth.uid()) and s.location_id is not null and s.state in ('saved','interested','visited')
  )
  select location_id,null::text,null::text,null::text,null::double precision,null::double precision from seen where (select auth.uid()) is not null
$$;

-- No fallback to the old v3/Postgres catalogue recorder.
create or replace function public.record_discovery_actions_v4_unchecked(actions jsonb)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare actor uuid:=(select auth.uid()); result jsonb;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if jsonb_typeof(coalesce(actions,'[]'::jsonb))<>'array' then raise exception 'actions must be an array'; end if;
  if jsonb_array_length(coalesce(actions,'[]'::jsonb)) not between 1 and 20 then raise exception 'invalid action batch size'; end if;
  if exists(
    select 1 from jsonb_to_recordset(actions) as item("contentKind" text,"contentId" uuid,action text,"eventId" uuid)
    where coalesce(item."contentKind",'place')<>'place' or item."contentId" is null or item."eventId" is null
      or item.action not in ('saved','interested','dismissed','visited')
  ) then raise exception 'invalid action'; end if;
  if exists(select 1 from jsonb_to_recordset(actions) as item("contentId" uuid) group by item."contentId" having count(*)>1) then raise exception 'duplicate location in action batch'; end if;
  if (select count(*)<>count(distinct item."eventId") from jsonb_to_recordset(actions) as item("eventId" uuid)) then raise exception 'eventId values must be unique'; end if;
  if exists(
    select 1 from jsonb_to_recordset(actions) as item("eventId" uuid)
    join public.discovery_action_receipts receipt on receipt.profile_id=actor and receipt.event_id=item."eventId"
  ) then raise exception 'eventId already recorded'; end if;
  if exists(
    select 1 from jsonb_to_recordset(actions) as item("contentId" uuid)
    where not exists(select 1 from public.location_refs ref where ref.id=item."contentId")
  ) then raise exception 'place unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  with positive as (select item.* from jsonb_to_recordset(actions) as item("contentId" uuid,action text) where item.action in ('saved','interested','visited'))
  update public.discovery_actions h set undone_at=now() from positive where h.profile_id=actor and h.location_id=positive."contentId" and h.action='dismissed' and h.undone_at is null;
  with positive as (select item.* from jsonb_to_recordset(actions) as item("contentId" uuid,action text) where item.action in ('saved','interested','visited'))
  delete from public.user_content_states s using positive where s.profile_id=actor and s.location_id=positive."contentId" and s.state=positive.action;
  with positive as (select item.* from jsonb_to_recordset(actions) as item("contentId" uuid,action text) where item.action in ('saved','interested','visited'))
  insert into public.user_content_states(profile_id,event_id,location_id,state) select actor,null,positive."contentId",positive.action from positive;
  with writes as (select item.* from jsonb_to_recordset(actions) as item("contentId" uuid,action text,"requestId" uuid))
  insert into public.discovery_actions(profile_id,request_id,content_kind,event_id,location_id,action)
    select actor,writes."requestId",'place',null,writes."contentId",writes.action from writes;
  with parsed as (
    select item.* from jsonb_to_recordset(actions) as item("contentId" uuid,action text,"requestedAction" text,"eventId" uuid,context jsonb)
  ), queued as (
    select parsed.*,case when coalesce(parsed."requestedAction",parsed.action)='perfect' then 'perfect' when parsed.action='dismissed' then 'pass' when parsed.action in ('saved','interested') then 'save' when parsed.action='visited' then 'visited' end event_name from parsed
  )
  insert into public.discovery_context_outbox(profile_id,event_id,location_id,event_name,context_mode,context_category,context_payload)
    select actor,queued."eventId",queued."contentId",queued.event_name,coalesce(queued.context->>'mode','solo'),nullif(queued.context->>'category',''),coalesce(queued.context->'payload','{}'::jsonb)
    from queued where queued.event_name is not null on conflict(profile_id,event_id) do nothing;
  with parsed as (
    select item.* from jsonb_to_recordset(actions) as item("contentId" uuid,action text,"requestedAction" text,"eventId" uuid,"sequence" integer)
  ), built as (
    select parsed."eventId",coalesce(parsed."sequence",0) sequence,jsonb_build_object('action',parsed.action,'locationId',parsed."contentId",'perfectPick',coalesce(parsed."requestedAction",parsed.action)='perfect','eventId',parsed."eventId",'sequence',coalesce(parsed."sequence",0)) result from parsed
  )
  insert into public.discovery_action_receipts(profile_id,event_id,sequence,result) select actor,built."eventId",built.sequence,built.result from built;
  select coalesce(jsonb_agg(receipt.result order by receipt.sequence),'[]'::jsonb) into result
  from jsonb_to_recordset(actions) as item("eventId" uuid)
  join public.discovery_action_receipts receipt on receipt.profile_id=actor and receipt.event_id=item."eventId";
  return result;
end
$$;

create or replace function public.process_discovery_context_outbox_v1(batch_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare safe_limit integer:=least(500,greatest(1,coalesce(batch_limit,100))); processed integer:=0;
begin
  if coalesce(auth.role()::text,'')<>'service_role' then raise exception 'service role required'; end if;
  create temporary table if not exists discovery_context_claims(id bigint primary key,profile_id uuid not null,event_id uuid not null,location_id uuid not null,event_name text,context_mode text,context_category text,context_payload jsonb,created_at timestamptz) on commit drop;
  truncate discovery_context_claims;
  insert into discovery_context_claims
    select q.id,q.profile_id,q.event_id,q.location_id,q.event_name,q.context_mode,q.context_category,q.context_payload,q.created_at
    from public.discovery_context_outbox q where q.processed_at is null order by q.id for update skip locked limit safe_limit;
  insert into public.recommendation_context_events(profile_id,source,source_key,location_id,outcome,signal_weight,category,price_level,amenities,distance_m,daypart,day_type,intent,filters,metadata,occurred_at,undone_at)
  select c.profile_id,'discovery','discovery_outbox:'||c.event_id::text,c.location_id,
    case c.event_name when 'opened' then 'opened' when 'pass' then 'dismissed' when 'save' then 'saved' when 'perfect' then 'saved' else 'visited' end,
    case c.event_name when 'opened' then 1 when 'pass' then -3 when 'save' then 4 when 'perfect' then 7 when 'visited' then 8 else 1 end,
    c.context_category,null,'{}'::text[],null,
    case when c.context_payload->>'daypart'='late' then 'late_night' when c.context_payload->>'daypart' in ('morning','afternoon','evening','late_night') then c.context_payload->>'daypart' when extract(hour from c.created_at at time zone 'UTC') between 5 and 11 then 'morning' when extract(hour from c.created_at at time zone 'UTC') between 12 and 16 then 'afternoon' when extract(hour from c.created_at at time zone 'UTC') between 17 and 21 then 'evening' else 'late_night' end,
    case when extract(isodow from c.created_at at time zone 'UTC')>=6 then 'weekend' else 'weekday' end,
    coalesce(public.contextual_intent_bucket_v1(coalesce(c.context_payload,'{}'::jsonb)),c.context_mode),
    coalesce(c.context_payload,'{}'::jsonb),coalesce(c.context_payload,'{}'::jsonb)||jsonb_build_object('source','discovery_context_outbox','event_type',c.event_name,'mode',c.context_mode,'perfect_pick',c.event_name='perfect'),c.created_at,null
  from discovery_context_claims c where c.event_name is not null
  on conflict(profile_id,source_key,location_id,outcome) do nothing;
  update public.discovery_context_outbox q set processed_at=now() from discovery_context_claims c where q.id=c.id;
  get diagnostics processed=row_count;
  return jsonb_build_object('processed',processed);
end
$$;

create or replace function public.add_plan_stop_v1(target_plan uuid,target_kind text,target_id uuid,planned_time timestamptz default null,stop_note text default null)
returns uuid language plpgsql security definer set search_path='public' as $$
declare actor uuid:=(select auth.uid());next_position numeric;created uuid;
begin
  if actor is null or not public.can_edit_plan(target_plan) then raise exception 'not authorized'; end if;
  if target_kind not in ('event','place') then raise exception 'invalid stop kind'; end if;
  if target_kind='event' and not exists(select 1 from public.events where id=target_id and status='published') then raise exception 'event unavailable'; end if;
  if target_kind='place' and not exists(select 1 from public.location_refs where id=target_id) then raise exception 'place unavailable'; end if;
  select coalesce(max(position),0)+1000 into next_position from public.plan_stops where plan_id=target_plan;
  insert into public.plan_stops(plan_id,event_id,location_id,position,planned_for,note,added_by)
  values(target_plan,case when target_kind='event' then target_id end,case when target_kind='place' then target_id end,next_position,planned_time,left(stop_note,1000),actor) returning id into created;
  return created;
end
$$;

create or replace function public.send_location_to_friend_v1(target_friend uuid,target_location uuid,share_note text default null)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare cid uuid;sid bigint;mid bigint;
begin
  if not public.profiles_are_friends((select auth.uid()),target_friend) then raise exception 'Friend unavailable.'; end if;
  if not exists(select 1 from public.location_refs where id=target_location) then raise exception 'Place unavailable.'; end if;
  cid:=public.social_open_direct_conversation_v1(target_friend);
  insert into public.content_shares(sender_id,recipient_id,location_id,note) values((select auth.uid()),target_friend,target_location,left(nullif(trim(coalesce(share_note,'')),''),1000)) returning id into sid;
  insert into public.messages(conversation_id,sender_id,body,message_type,metadata)
    values(cid,(select auth.uid()),coalesce(nullif(left(trim(coalesce(share_note,'')),5000),''),'Shared a place'),'location',jsonb_build_object('locationId',target_location,'shareId',sid)) returning id into mid;
  update public.conversations set updated_at=now() where id=cid;
  return jsonb_build_object('conversationId',cid,'messageId',mid,'shareId',sid);
end
$$;

create or replace function public.social_send_location_message_v1(target uuid,target_location uuid)
returns bigint language plpgsql security definer set search_path='public' as $$
declare mid bigint;peer uuid;
begin
  peer:=public.social_conversation_peer_v2(target);
  if peer is null then raise exception 'Conversation unavailable.'; end if;
  if not exists(select 1 from public.location_refs where id=target_location) then raise exception 'Location unavailable.'; end if;
  insert into public.messages(conversation_id,sender_id,body,message_type,metadata)
    values(target,(select auth.uid()),'Shared a place','location',jsonb_build_object('locationId',target_location)) returning id into mid;
  update public.conversations set updated_at=now() where id=target;
  perform public.queue_notification_v1(peer,(select auth.uid()),'message','Place shared with you','Shared place','/matches?tab=messages&conversation='||target::text,jsonb_build_object('conversationId',target,'messageId',mid,'locationId',target_location));
  return mid;
end
$$;

create or replace function public.global_like_matches_v1(max_rows integer default 48)
returns table(user_id uuid,display_name text,username text,bio text,avatar_path text,user_city text,user_country text,intent text,location_id uuid,location_name text,location_city text,cover_path text,shared_at timestamptz)
language plpgsql stable security definer set search_path='public' as $$
declare actor uuid:=(select auth.uid());
begin
  if actor is null then raise exception 'authentication required'; end if;
  if not public.puddle_tinder_active_v1(actor) then raise exception 'Tinder tier required'; end if;
  if not public.puddle_adult_v1(actor) then raise exception 'global connections require age 18 or older'; end if;
  if not exists(select 1 from public.global_connection_preferences p where p.user_id=actor and p.discoverable) then return; end if;
  return query
  with my_likes as (
    select a.location_id,max(a.created_at) liked_at from public.discovery_actions a where a.profile_id=actor and a.action in ('saved','interested') and a.undone_at is null group by a.location_id
  ), their_likes as (
    select a.profile_id,a.location_id,max(a.created_at) liked_at from public.discovery_actions a where a.profile_id<>actor and a.action in ('saved','interested') and a.undone_at is null group by a.profile_id,a.location_id
  )
  select p.id,p.display_name,p.username,p.bio,p.avatar_path,p.city,p.country,pref.intent,mine.location_id,
    null::text,null::text,null::text,greatest(mine.liked_at,theirs.liked_at)
  from my_likes mine join their_likes theirs on theirs.location_id=mine.location_id
  join public.profiles p on p.id=theirs.profile_id
  join public.global_connection_preferences pref on pref.user_id=p.id and pref.discoverable
  where public.puddle_tinder_active_v1(p.id) and public.puddle_adult_v1(p.id) and coalesce(p.profile_visibility,'public')<>'hidden'
    and not exists(select 1 from public.global_connection_blocks b where (b.blocker_id=actor and b.blocked_id=p.id) or (b.blocker_id=p.id and b.blocked_id=actor))
  order by greatest(mine.liked_at,theirs.liked_at) desc,p.display_name
  limit least(96,greatest(1,coalesce(max_rows,48)));
end
$$;

create or replace function public.global_connection_snapshot_v1()
returns jsonb language plpgsql stable security definer set search_path='public' as $$
declare actor uuid:=(select auth.uid());result jsonb;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if not public.puddle_tinder_active_v1(actor) or not public.puddle_adult_v1(actor) then return jsonb_build_object('eligible',false,'threads','[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'status',t.status,'intent',t.intent,'incoming',t.recipient_id=actor,'createdAt',t.created_at,'updatedAt',t.updated_at,
    'locationId',t.location_id,'person',jsonb_build_object('id',p.id,'displayName',p.display_name,'username',p.username,'avatarPath',p.avatar_path,'city',p.city,'country',p.country),
    'place',jsonb_build_object('id',t.location_id),
    'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'senderId',m.sender_id,'body',m.body,'createdAt',m.created_at) order by m.created_at,m.id)
      from (select item.* from public.global_connection_messages item where item.thread_id=t.id order by item.created_at desc,item.id desc limit 100) m),'[]'::jsonb)
  ) order by t.updated_at desc),'[]'::jsonb) into result
  from public.global_connection_threads t
  join public.profiles p on p.id=case when t.requester_id=actor then t.recipient_id else t.requester_id end
  where actor in (t.requester_id,t.recipient_id);
  return jsonb_build_object('eligible',true,'threads',coalesce(result,'[]'::jsonb));
end
$$;

-- Drop Supabase catalogue/search/enrichment RPCs rather than keeping fallback implementations.
drop function if exists public.catalogue_quality_review_v1(integer) cascade;
drop function if exists public.claim_google_place_candidates_v3(integer,integer,text) cascade;
drop function if exists public.claim_google_place_discovery_candidates_v1(integer,integer,text) cascade;
drop function if exists public.claim_google_place_geocode_candidates_v1(integer,integer,text) cascade;
drop function if exists public.claim_open_photo_candidates_v1(integer,integer,text) cascade;
drop function if exists public.complete_open_photo_candidate_v1(uuid,text,text,text,text,text,integer,integer,text,boolean,text) cascade;
drop function if exists public.discover_candidates_v1(double precision,double precision,double precision,text,text,integer,uuid[],text[]) cascade;
drop function if exists public.discovery_spatial_profile_v1() cascade;
drop function if exists public.finalize_catalogue_region_refresh_v1(uuid) cascade;
drop function if exists public.find_open_location_match_v1(text,double precision,double precision,double precision) cascade;
drop function if exists public.find_open_location_match_v2(text,double precision,double precision,double precision,text) cascade;
drop function if exists public.pass_location_heatmap_v1() cascade;
drop function if exists public.r2_discovery_overlay_v2(uuid[]) cascade;
drop function if exists public.upsert_open_catalogue_location_v1(jsonb) cascade;
drop function if exists public.record_discovery_actions_v3(jsonb) cascade;

-- The imported relational catalogue is gone after every surviving FK/RPC has moved away.
drop table public.locations cascade;

-- Protect public SECURITY DEFINER RPCs used by the product.
revoke all on function public.location_saved_page_v1(boolean,timestamptz,uuid,integer,text,text) from public,anon;
grant execute on function public.location_saved_page_v1(boolean,timestamptz,uuid,integer,text,text) to authenticated,service_role;
revoke all on function public.location_planned_page_v1(timestamptz,uuid,integer) from public,anon;
grant execute on function public.location_planned_page_v1(timestamptz,uuid,integer) to authenticated,service_role;
revoke all on function public.location_history_page_v1(timestamptz,uuid,integer) from public,anon;
grant execute on function public.location_history_page_v1(timestamptz,uuid,integer) to authenticated,service_role;
revoke all on function public.discovery_seen_locations_v1() from public,anon;
grant execute on function public.discovery_seen_locations_v1() to authenticated,service_role;

commit;
