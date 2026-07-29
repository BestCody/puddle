-- Stage 8E: enforce the global creation-assistance kill switch and bind recommendation log policies to their outer rows.
-- Apply after 0017_stage8_authorization.sql.

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
  if not public.feature_enabled_v1('ai_creation_enabled') then raise exception 'AI creation is disabled'; end if;
  if provider_name<>'rules' then
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

revoke all on function public.reserve_ai_assistance_v1(text,uuid,text,jsonb,text,text,text,text,text) from public,anon;
grant execute on function public.reserve_ai_assistance_v1(text,uuid,text,jsonb,text,text,text,text,text) to authenticated;

drop policy if exists "users log own eligibility decisions" on public.recommendation_eligibility_logs;
create policy "users log own eligibility decisions" on public.recommendation_eligibility_logs for insert to authenticated
with check (
  profile_id=auth.uid()
  and exists(
    select 1 from public.recommendation_requests r
    where r.request_id=recommendation_eligibility_logs.request_id and r.profile_id=auth.uid()
  )
);

drop policy if exists "users log own recommendation candidates" on public.recommendation_candidates;
create policy "users log own recommendation candidates" on public.recommendation_candidates for insert to authenticated
with check (
  profile_id=auth.uid()
  and exists(
    select 1 from public.recommendation_requests r
    where r.request_id=recommendation_candidates.request_id and r.profile_id=auth.uid()
  )
);
