-- Stage 8 schema, RLS, worker authorization, grounding audit, and fallback assertions.
begin;

do $$
declare missing text[];rls_missing text[];
begin
  if not exists(select 1 from pg_extension where extname='vector') then raise exception 'pgvector extension is missing'; end if;
  select array_agg(name) into missing from unnest(array[
    'feature_flags','ai_assistance_runs','content_embeddings','user_preference_embeddings','embedding_jobs','recommendation_preferences',
    'recommendation_ranking_configs','recommendation_experiments','recommendation_assignments','recommendation_requests','recommendation_eligibility_logs','recommendation_candidates','recommendation_outcomes','recommendation_metrics'
  ]) name where to_regclass('public.'||name) is null;
  if missing is not null then raise exception 'Missing Stage 8 tables: %',missing; end if;

  select array_agg(c.relname) into rls_missing from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname=any(array['feature_flags','ai_assistance_runs','content_embeddings','user_preference_embeddings','embedding_jobs','recommendation_preferences','recommendation_ranking_configs','recommendation_experiments','recommendation_assignments','recommendation_requests','recommendation_eligibility_logs','recommendation_candidates','recommendation_outcomes','recommendation_metrics']) and not c.relrowsecurity;
  if rls_missing is not null then raise exception 'RLS is not enabled on Stage 8 tables: %',rls_missing; end if;

  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='content_embeddings_hnsw_idx') then raise exception 'Content embedding HNSW index is missing'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='recommendation_candidates_impression_dedupe_idx') then raise exception 'Recommendation impression deduplication is missing'; end if;
  if position('not coalesce(l.has_private_address,false)' in pg_get_functiondef('public.recommendation_candidate_pool_v1(double precision,double precision,integer,integer)'::regprocedure))=0 then raise exception 'Private-address locations are exposed to recommendations'; end if;
  if not exists(select 1 from public.feature_flags where key='ai_creation_enabled' and enabled=false) then raise exception 'AI creation kill switch must default off'; end if;
  if position($needle$if not public.feature_enabled_v1('ai_creation_enabled')$needle$ in lower(pg_get_functiondef('public.reserve_ai_assistance_v1(text,uuid,text,jsonb,text,text,text,text,text)'::regprocedure)))=0 then raise exception 'AI creation kill switch does not cover all providers'; end if;
  if not exists(select 1 from public.feature_flags where key='ai_writing_enabled' and enabled=false) then raise exception 'AI writing kill switch must default off'; end if;
  if not exists(select 1 from public.feature_flags where key='ai_social_caption_enabled' and enabled=false) then raise exception 'AI social-caption kill switch must default off'; end if;
  if not exists(select 1 from public.recommendation_experiments where key='hybrid-ranking-v1' and variants::text like '%rules_holdout%') then raise exception 'Recommendation holdout is missing'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='recommendation_eligibility_logs' and policyname='users log own eligibility decisions' and with_check like '%recommendation_eligibility_logs.request_id%') then raise exception 'Eligibility logging policy is not bound to the outer request'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='recommendation_candidates' and policyname='users log own recommendation candidates' and with_check like '%recommendation_candidates.request_id%') then raise exception 'Candidate logging policy is not bound to the outer request'; end if;

  if has_function_privilege('anon','public.reserve_ai_assistance_v1(text,uuid,text,jsonb,text,text,text,text,text)','execute') then raise exception 'Anonymous users can reserve AI assistance'; end if;
  if has_function_privilege('authenticated','public.complete_ai_assistance_v1(uuid,jsonb,jsonb,jsonb,text,integer,text)','execute') then raise exception 'Authenticated clients can complete AI audit records'; end if;
  if has_function_privilege('authenticated','public.claim_embedding_jobs_v1(integer)','execute') then raise exception 'Authenticated clients can claim embedding jobs'; end if;
  if has_function_privilege('authenticated','public.queue_embedding_regeneration_v1(text)','execute') then raise exception 'Authenticated clients can queue global embedding regeneration'; end if;
  if has_table_privilege('authenticated','public.content_embeddings','select') then raise exception 'Authenticated clients can read raw content embeddings'; end if;
  if has_table_privilege('authenticated','public.user_preference_embeddings','select') then raise exception 'Authenticated clients can read preference embeddings'; end if;
end $$;

rollback;
