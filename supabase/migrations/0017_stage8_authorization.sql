-- Stage 8D: row-level security and execution grants.
-- Apply after 0016_hybrid_recommendation_runtime.sql.

alter table public.feature_flags enable row level security;
alter table public.ai_assistance_runs enable row level security;
alter table public.content_embeddings enable row level security;
alter table public.user_preference_embeddings enable row level security;
alter table public.embedding_jobs enable row level security;
alter table public.recommendation_preferences enable row level security;
alter table public.recommendation_ranking_configs enable row level security;
alter table public.recommendation_experiments enable row level security;
alter table public.recommendation_assignments enable row level security;
alter table public.recommendation_requests enable row level security;
alter table public.recommendation_eligibility_logs enable row level security;
alter table public.recommendation_candidates enable row level security;
alter table public.recommendation_outcomes enable row level security;
alter table public.recommendation_metrics enable row level security;

create policy "feature flags readable" on public.feature_flags for select to authenticated using (true);
create policy "admins manage feature flags" on public.feature_flags for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "users read own AI runs" on public.ai_assistance_runs for select to authenticated using (profile_id=auth.uid() or public.is_admin());
create policy "users read own recommendation preferences" on public.recommendation_preferences for select to authenticated using (profile_id=auth.uid());
create policy "users insert own recommendation preferences" on public.recommendation_preferences for insert to authenticated with check (profile_id=auth.uid());
create policy "users update own recommendation preferences" on public.recommendation_preferences for update to authenticated using (profile_id=auth.uid()) with check (profile_id=auth.uid());
create policy "ranking configs readable" on public.recommendation_ranking_configs for select to authenticated using (true);
create policy "admins manage ranking configs" on public.recommendation_ranking_configs for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "experiments readable" on public.recommendation_experiments for select to authenticated using (true);
create policy "users read own experiment assignments" on public.recommendation_assignments for select to authenticated using (profile_id=auth.uid());
create policy "users read own recommendation requests" on public.recommendation_requests for select to authenticated using (profile_id=auth.uid());
create policy "users log own recommendation requests" on public.recommendation_requests for insert to authenticated with check (profile_id=auth.uid());
create policy "users read own eligibility logs" on public.recommendation_eligibility_logs for select to authenticated using (profile_id=auth.uid());
create policy "users log own eligibility decisions" on public.recommendation_eligibility_logs for insert to authenticated with check (profile_id=auth.uid() and exists(select 1 from public.recommendation_requests r where r.request_id=request_id and r.profile_id=auth.uid()));
create policy "users read own recommendation candidates" on public.recommendation_candidates for select to authenticated using (profile_id=auth.uid());
create policy "users log own recommendation candidates" on public.recommendation_candidates for insert to authenticated with check (profile_id=auth.uid() and exists(select 1 from public.recommendation_requests r where r.request_id=request_id and r.profile_id=auth.uid()));
create policy "users read own recommendation outcomes" on public.recommendation_outcomes for select to authenticated using (profile_id=auth.uid());
create policy "admins read recommendation metrics" on public.recommendation_metrics for select to authenticated using (public.is_admin());

revoke all on function public.complete_ai_assistance_v1(uuid,jsonb,jsonb,jsonb,text,integer,text) from public,anon,authenticated;
revoke all on function public.queue_embedding_regeneration_v1(text) from public,anon,authenticated;
revoke all on function public.claim_embedding_jobs_v1(integer) from public,anon,authenticated;
revoke all on function public.store_embedding_job_v1(bigint,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.fail_embedding_job_v1(bigint,text,integer) from public,anon,authenticated;
revoke all on function public.recommendation_preference_text_v1(uuid) from public,anon,authenticated;
revoke all on function public.confirm_ai_on_content_submission_v1() from public,anon,authenticated;
revoke all on function public.capture_operational_recommendation_outcome_v1() from public,anon,authenticated;
revoke all on function public.queue_content_embedding_v1() from public,anon,authenticated;
revoke all on function public.queue_preference_embedding_v1() from public,anon,authenticated;

revoke all on function public.reserve_ai_assistance_v1(text,uuid,text,jsonb,text,text,text,text,text) from public,anon;
revoke all on function public.decide_ai_assistance_v1(uuid,text,jsonb,uuid) from public,anon;
revoke all on function public.confirm_ai_publication_v1(text,uuid) from public,anon;
revoke all on function public.feature_enabled_v1(text) from public,anon;
revoke all on function public.can_manage_ai_content(text,uuid) from public,anon;
revoke all on function public.activate_recommendation_ranking_v1(text) from public,anon;
revoke all on function public.assign_recommendation_experiment_v1(text) from public,anon;
revoke all on function public.recommendation_context_v1() from public,anon;
revoke all on function public.recommendation_candidate_pool_v1(double precision,double precision,integer,integer) from public,anon;
revoke all on function public.record_recommendation_outcome_v1(uuid,text,uuid,text,jsonb) from public,anon;
revoke all on function public.save_recommendation_preferences_v1(boolean,boolean,boolean,boolean) from public,anon;
revoke all on function public.reset_recommendation_preferences_v1() from public,anon;
revoke all on function public.delete_recommendation_data_v1() from public,anon;

grant select on public.feature_flags,public.ai_assistance_runs,public.recommendation_preferences,public.recommendation_ranking_configs,public.recommendation_experiments,public.recommendation_assignments,public.recommendation_requests,public.recommendation_eligibility_logs,public.recommendation_candidates,public.recommendation_outcomes,public.recommendation_metrics to authenticated;
grant insert,update on public.recommendation_preferences to authenticated;
grant insert,update,delete on public.feature_flags,public.recommendation_ranking_configs,public.recommendation_experiments to authenticated;
grant insert on public.recommendation_requests,public.recommendation_eligibility_logs,public.recommendation_candidates to authenticated;
grant usage,select on sequence public.recommendation_eligibility_logs_id_seq,public.recommendation_candidates_id_seq,public.recommendation_outcomes_id_seq to authenticated;
grant execute on function public.reserve_ai_assistance_v1(text,uuid,text,jsonb,text,text,text,text,text) to authenticated;
grant execute on function public.decide_ai_assistance_v1(uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.confirm_ai_publication_v1(text,uuid) to authenticated;
grant execute on function public.feature_enabled_v1(text) to authenticated;
grant execute on function public.can_manage_ai_content(text,uuid) to authenticated;
grant execute on function public.activate_recommendation_ranking_v1(text) to authenticated;
grant execute on function public.assign_recommendation_experiment_v1(text) to authenticated;
grant execute on function public.recommendation_context_v1() to authenticated;
grant execute on function public.recommendation_candidate_pool_v1(double precision,double precision,integer,integer) to authenticated;
grant execute on function public.record_recommendation_outcome_v1(uuid,text,uuid,text,jsonb) to authenticated;
grant execute on function public.save_recommendation_preferences_v1(boolean,boolean,boolean,boolean) to authenticated;
grant execute on function public.reset_recommendation_preferences_v1() to authenticated;
grant execute on function public.delete_recommendation_data_v1() to authenticated;

grant execute on function public.complete_ai_assistance_v1(uuid,jsonb,jsonb,jsonb,text,integer,text) to service_role;
grant execute on function public.queue_embedding_regeneration_v1(text) to service_role;
grant execute on function public.claim_embedding_jobs_v1(integer) to service_role;
grant execute on function public.store_embedding_job_v1(bigint,text,text,text,integer) to service_role;
grant execute on function public.fail_embedding_job_v1(bigint,text,integer) to service_role;
grant select,insert,update,delete on public.content_embeddings,public.user_preference_embeddings,public.embedding_jobs,public.recommendation_metrics to service_role;
grant select on public.recommendation_requests,public.recommendation_eligibility_logs,public.recommendation_candidates,public.recommendation_outcomes to service_role;
grant usage,select on sequence public.embedding_jobs_id_seq,public.recommendation_metrics_id_seq to service_role;
