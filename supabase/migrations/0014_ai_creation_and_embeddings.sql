-- Stage 8A: local AI-assisted creation and content embedding foundations.
-- Apply after 0013_stage7_worker_access.sql. No hosted AI API key is required.

-- Stage 8: local AI-assisted creation, pgvector embeddings, and hybrid recommendations.
-- Apply after 0013_stage7_worker_access.sql.
-- This migration never requires an OpenAI, Anthropic, Gemini, Cohere, or other hosted-model API key.

create extension if not exists vector with schema extensions;

create table if not exists public.feature_flags (
  key text primary key check (key ~ '^[a-z0-9_]{3,80}$'),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.feature_flags(key,enabled,config) values
  ('ai_creation_enabled',false,'{"provider":"local_ollama","prompt_version":"stage8-v1"}'::jsonb),
  ('ai_writing_enabled',false,'{}'::jsonb),
  ('ai_social_caption_enabled',false,'{}'::jsonb),
  ('vector_recommendations_enabled',true,'{"dimensions":768,"ranking_version":"hybrid-v1"}'::jsonb),
  ('behavioral_recommendations_enabled',true,'{}'::jsonb)
on conflict(key) do nothing;

create or replace function public.feature_enabled_v1(flag_key text)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select enabled from public.feature_flags where key=flag_key),false)
$$;

create or replace function public.can_manage_ai_content(target_kind text,target_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select case
    when target_kind='event' then public.can_manage_event(target_id)
    when target_kind='location' then public.can_manage_location(target_id)
    else false
  end
$$;

create table if not exists public.ai_assistance_runs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  host_profile_id uuid references public.host_profiles(id) on delete set null,
  content_kind text not null check (content_kind in ('event','location')),
  content_id uuid,
  purpose text not null check (purpose in ('title','short_description','description','categories_tags','accessibility_prompts','social_caption','missing_information')),
  source_fields jsonb not null,
  source_hash text not null,
  sanitized_prompt text not null check (char_length(sanitized_prompt)<=16000),
  provider text not null check (provider in ('local_ollama','rules')),
  model text not null,
  model_version text not null,
  prompt_version text not null,
  output jsonb,
  moderation jsonb not null default '{}'::jsonb,
  grounding jsonb not null default '{}'::jsonb,
  status text not null default 'requested' check (status in ('requested','generated','blocked','accepted','rejected','rolled_back','failed')),
  human_edits jsonb,
  accepted_at timestamptz,
  rejected_at timestamptz,
  rolled_back_at timestamptz,
  publication_confirmed_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 300000),
  error_category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_assistance_runs_profile_idx on public.ai_assistance_runs(profile_id,created_at desc);
create index if not exists ai_assistance_runs_content_idx on public.ai_assistance_runs(content_kind,content_id,created_at desc) where content_id is not null;
create index if not exists ai_assistance_runs_rate_idx on public.ai_assistance_runs(profile_id,created_at) where status<>'failed';

create or replace function public.reserve_ai_assistance_v1(
  target_kind text,
  target_id uuid,
  request_purpose text,
  source_data jsonb,
  prompt_text text,
  provider_name text,
  model_name text,
  model_revision text,
  prompt_revision text
) returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();run_id uuid;host_id uuid;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if provider_name<>'rules' then
    if not public.feature_enabled_v1('ai_creation_enabled') then raise exception 'AI creation is disabled'; end if;
    if request_purpose='social_caption' and not public.feature_enabled_v1('ai_social_caption_enabled') then raise exception 'AI social captions are disabled'; end if;
    if request_purpose<>'social_caption' and not public.feature_enabled_v1('ai_writing_enabled') then raise exception 'AI writing is disabled'; end if;
  end if;
  if target_kind not in ('event','location') then raise exception 'invalid content kind'; end if;
  if request_purpose not in ('title','short_description','description','categories_tags','accessibility_prompts','social_caption','missing_information') then raise exception 'invalid assistance purpose'; end if;
  if jsonb_typeof(source_data)<>'object' or octet_length(source_data::text)>24000 then raise exception 'source fields are invalid'; end if;
  if target_id is not null and not public.can_manage_ai_content(target_kind,target_id) then raise exception 'not authorized for this draft'; end if;
  if (select count(*) from public.ai_assistance_runs where profile_id=actor and created_at>now()-interval '1 hour')>=20 then raise exception 'hourly AI assistance limit reached'; end if;
  if (select count(*) from public.ai_assistance_runs where profile_id=actor and created_at>now()-interval '1 day')>=100 then raise exception 'daily AI assistance limit reached'; end if;
  if target_id is not null then
    if target_kind='event' then select host_profile_id into host_id from public.events where id=target_id;
    else select host_profile_id into host_id from public.locations where id=target_id; end if;
  end if;
  if host_id is not null and (select count(*) from public.ai_assistance_runs where host_profile_id=host_id and created_at>now()-interval '1 hour')>=60 then raise exception 'host hourly AI assistance limit reached'; end if;
  if host_id is not null and (select count(*) from public.ai_assistance_runs where host_profile_id=host_id and created_at>now()-interval '1 day')>=300 then raise exception 'host daily AI assistance limit reached'; end if;
  insert into public.ai_assistance_runs(profile_id,host_profile_id,content_kind,content_id,purpose,source_fields,source_hash,sanitized_prompt,provider,model,model_version,prompt_version)
  values(actor,host_id,target_kind,target_id,request_purpose,source_data,md5(source_data::text),left(prompt_text,16000),provider_name,left(model_name,160),left(model_revision,160),left(prompt_revision,80))
  returning id into run_id;
  return run_id;
end;
$$;

create or replace function public.complete_ai_assistance_v1(
  target_run uuid,
  result_output jsonb,
  moderation_result jsonb,
  grounding_result jsonb,
  final_status text,
  elapsed_ms integer default null,
  failure_category text default null
) returns void language plpgsql security definer set search_path=public as $$
begin
  if final_status not in ('generated','blocked','failed') then raise exception 'invalid completion status'; end if;
  update public.ai_assistance_runs set
    output=result_output,
    moderation=coalesce(moderation_result,'{}'::jsonb),
    grounding=coalesce(grounding_result,'{}'::jsonb),
    status=final_status,
    duration_ms=elapsed_ms,
    error_category=left(failure_category,120),
    updated_at=now()
  where id=target_run and status='requested';
  if not found then raise exception 'AI assistance run is unavailable'; end if;
end;
$$;

create or replace function public.decide_ai_assistance_v1(target_run uuid,decision text,edited_output jsonb default null,attach_content_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();current_run public.ai_assistance_runs%rowtype;
begin
  if actor is null then raise exception 'authentication required'; end if;
  select * into current_run from public.ai_assistance_runs where id=target_run and profile_id=actor for update;
  if current_run.id is null then raise exception 'AI assistance run not found'; end if;
  if decision='accept' then
    if current_run.status<>'generated' then raise exception 'only generated output can be accepted'; end if;
    if edited_output is null or jsonb_typeof(edited_output)<>'object' or octet_length(edited_output::text)>24000 then raise exception 'human-reviewed output is required'; end if;
    if attach_content_id is not null then
      if not public.can_manage_ai_content(current_run.content_kind,attach_content_id) then raise exception 'draft attachment is not authorized'; end if;
      update public.ai_assistance_runs set content_id=coalesce(content_id,attach_content_id) where id=target_run;
    end if;
    update public.ai_assistance_runs set status='accepted',human_edits=edited_output,accepted_at=now(),updated_at=now() where id=target_run;
  elsif decision='reject' then
    if current_run.status not in ('generated','blocked') then raise exception 'run cannot be rejected'; end if;
    update public.ai_assistance_runs set status='rejected',rejected_at=now(),updated_at=now() where id=target_run;
  elsif decision='rollback' then
    if current_run.status<>'accepted' then raise exception 'only accepted output can be rolled back'; end if;
    update public.ai_assistance_runs set status='rolled_back',rolled_back_at=now(),updated_at=now() where id=target_run;
  else raise exception 'invalid decision'; end if;
  return jsonb_build_object('id',target_run,'status',(select status from public.ai_assistance_runs where id=target_run),'human_edits',(select human_edits from public.ai_assistance_runs where id=target_run));
end;
$$;

create or replace function public.confirm_ai_publication_v1(target_kind text,target_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
  if auth.uid() is null or not public.can_manage_ai_content(target_kind,target_id) then raise exception 'not authorized'; end if;
  update public.ai_assistance_runs set publication_confirmed_at=coalesce(publication_confirmed_at,now()),updated_at=now()
  where profile_id=auth.uid() and content_kind=target_kind and content_id=target_id and status='accepted';
  get diagnostics changed=row_count;
  return changed;
end;
$$;

create or replace function public.confirm_ai_on_content_submission_v1()
returns trigger language plpgsql security definer set search_path=public as $$
declare kind text;
begin
  kind:=case when tg_table_name='events' then 'event' else 'location' end;
  if new.status in ('pending_review','scheduled','published') and new.status is distinct from old.status then
    update public.ai_assistance_runs set publication_confirmed_at=coalesce(publication_confirmed_at,now()),updated_at=now()
    where content_kind=kind and content_id=new.id and status='accepted';
  end if;
  return new;
end;
$$;
drop trigger if exists events_confirm_ai_submission on public.events;
create trigger events_confirm_ai_submission after update of status on public.events for each row execute function public.confirm_ai_on_content_submission_v1();
drop trigger if exists locations_confirm_ai_submission on public.locations;
create trigger locations_confirm_ai_submission after update of status on public.locations for each row execute function public.confirm_ai_on_content_submission_v1();

create table if not exists public.content_embeddings (
  id uuid primary key default gen_random_uuid(),
  content_kind text not null check (content_kind in ('event','place')),
  content_id uuid not null,
  embedding extensions.vector(768) not null,
  model text not null,
  model_version text not null,
  dimensions integer not null default 768 check (dimensions=768),
  normalization text not null default 'l2' check (normalization in ('l2','none')),
  source_hash text not null,
  active boolean not null default true,
  generated_at timestamptz not null default now(),
  stale_at timestamptz,
  deleted_at timestamptz,
  unique(content_kind,content_id,model,model_version,source_hash)
);
create unique index if not exists content_embeddings_one_active_idx on public.content_embeddings(content_kind,content_id,model,model_version) where active and deleted_at is null;
create index if not exists content_embeddings_lookup_idx on public.content_embeddings(content_kind,content_id,generated_at desc) where active and deleted_at is null;
create index if not exists content_embeddings_hnsw_idx on public.content_embeddings using hnsw (embedding extensions.vector_cosine_ops) where active and deleted_at is null;

create table if not exists public.user_preference_embeddings (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  embedding extensions.vector(768) not null,
  model text not null,
  model_version text not null,
  dimensions integer not null default 768 check (dimensions=768),
  normalization text not null default 'l2' check (normalization in ('l2','none')),
  source_hash text not null,
  active boolean not null default true,
  generated_at timestamptz not null default now(),
  stale_at timestamptz,
  deleted_at timestamptz,
  unique(profile_id,model,model_version,source_hash)
);
create unique index if not exists user_preference_embeddings_one_active_idx on public.user_preference_embeddings(profile_id,model,model_version) where active and deleted_at is null;

create table if not exists public.embedding_jobs (
  id bigint generated always as identity primary key,
  target_type text not null check (target_type in ('content','user')),
  content_kind text check (content_kind in ('event','place')),
  content_id uuid,
  profile_id uuid references public.profiles(id) on delete cascade,
  source_hash text not null,
  status text not null default 'queued' check (status in ('queued','processing','done','failed','cancelled')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  finished_at timestamptz,
  error_category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint embedding_jobs_target_check check (
    (target_type='content' and content_kind is not null and content_id is not null and profile_id is null)
    or (target_type='user' and content_kind is null and content_id is null and profile_id is not null)
  )
);
create index if not exists embedding_jobs_queue_idx on public.embedding_jobs(status,next_attempt_at,created_at);
create index if not exists embedding_jobs_content_idx on public.embedding_jobs(content_kind,content_id,created_at desc) where target_type='content';
create index if not exists embedding_jobs_user_idx on public.embedding_jobs(profile_id,created_at desc) where target_type='user';
create unique index if not exists embedding_jobs_active_content_unique on public.embedding_jobs(content_kind,content_id) where target_type='content' and status in ('queued','processing');
create unique index if not exists embedding_jobs_active_user_unique on public.embedding_jobs(profile_id) where target_type='user' and status in ('queued','processing');

create or replace function public.queue_content_embedding_v1()
returns trigger language plpgsql security definer set search_path=public as $$
declare kind text;source_value text;hash_value text;existing_job bigint;
begin
  kind:=case when tg_table_name='events' then 'event' else 'place' end;
  if tg_op='DELETE' then
    update public.content_embeddings set active=false,deleted_at=now() where content_kind=kind and content_id=old.id and deleted_at is null;
    update public.embedding_jobs set status='cancelled',updated_at=now() where target_type='content' and content_kind=kind and content_id=old.id and status in ('queued','processing');
    return old;
  end if;
  if kind='event' then source_value:=concat_ws(' | ',new.title,new.category,array_to_string(new.tags,' '),new.summary,new.description);
  else source_value:=concat_ws(' | ',new.name,new.kind,array_to_string(new.tags,' '),new.summary,new.description,array_to_string(new.amenities,' ')); end if;
  hash_value:=md5(coalesce(source_value,''));
  update public.content_embeddings set active=false,stale_at=coalesce(stale_at,now()) where content_kind=kind and content_id=new.id and source_hash<>hash_value and active;
  select id into existing_job from public.embedding_jobs where target_type='content' and content_kind=kind and content_id=new.id and status in ('queued','processing') order by id desc limit 1 for update;
  if existing_job is null then
    insert into public.embedding_jobs(target_type,content_kind,content_id,source_hash) values('content',kind,new.id,hash_value);
  else
    update public.embedding_jobs set source_hash=hash_value,status='queued',next_attempt_at=now(),locked_at=null,error_category=null,updated_at=now() where id=existing_job;
  end if;
  return new;
end;
$$;

drop trigger if exists events_queue_embedding on public.events;
create trigger events_queue_embedding after insert or update of title,summary,description,category,tags,status on public.events for each row execute function public.queue_content_embedding_v1();
drop trigger if exists events_delete_embedding on public.events;
create trigger events_delete_embedding after delete on public.events for each row execute function public.queue_content_embedding_v1();
drop trigger if exists locations_queue_embedding on public.locations;
create trigger locations_queue_embedding after insert or update of name,summary,description,kind,tags,amenities,status on public.locations for each row execute function public.queue_content_embedding_v1();
drop trigger if exists locations_delete_embedding on public.locations;
create trigger locations_delete_embedding after delete on public.locations for each row execute function public.queue_content_embedding_v1();
