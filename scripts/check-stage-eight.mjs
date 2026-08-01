import { access, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const root = process.cwd()
const required = [
  'app/api/ai/assist/route.js','app/api/ai/decision/route.js','app/api/recommendations/preferences/route.js',
  'app/settings/recommendations/page.js','components/ai-creation-assistant.js','components/recommendation-settings.js',
  'lib/ai/local-provider.js','lib/ai/embedding-provider.js','lib/ai/grounding.js','lib/app/hybrid-recommendations.js',
  'scripts/generate-content-embeddings.mjs','scripts/compute-recommendation-metrics.mjs','scripts/test-stage-eight-ranking.mjs',
  'supabase/migrations/0014_ai_creation_and_embeddings.sql','supabase/migrations/0015_hybrid_recommendation_foundation.sql','supabase/migrations/0016_hybrid_recommendation_runtime.sql','supabase/migrations/0017_stage8_authorization.sql','supabase/migrations/0018_stage8_hardening.sql','supabase/migrations/10006_contextual_recommendation_learning.sql','supabase/tests/0014_stage8_authorization.sql','docs/STAGE_8_SETUP.md','app/stage-eight.css'
]
for (const path of required) await access(join(root, path))
for (const path of [
  'app/api/ai/assist/route.js','app/api/ai/decision/route.js','app/api/recommendations/preferences/route.js','app/api/discovery/action/route.js',
  'lib/ai/local-provider.js','lib/ai/embedding-provider.js','lib/ai/grounding.js','lib/app/hybrid-recommendations.js','lib/app/discovery.js',
  'scripts/generate-content-embeddings.mjs','scripts/compute-recommendation-metrics.mjs','scripts/test-stage-eight-ranking.mjs'
]) execFileSync(process.execPath, ['--check', join(root, path)], { stdio: 'pipe' })
execFileSync(process.execPath, [join(root, 'scripts/test-stage-eight-ranking.mjs')], { stdio: 'inherit' })

const migrationNames = [
  '0014_ai_creation_and_embeddings.sql','0015_hybrid_recommendation_foundation.sql','0016_hybrid_recommendation_runtime.sql',
  '0017_stage8_authorization.sql','0018_stage8_hardening.sql','10006_contextual_recommendation_learning.sql'
]
const migration = (await Promise.all(migrationNames.map((name) => readFile(join(root, 'supabase/migrations', name), 'utf8')))).join('\n')
for (const marker of ['create extension if not exists vector','ai_assistance_runs','content_embeddings','user_preference_embeddings','embedding_jobs','recommendation_ranking_configs','recommendation_eligibility_logs','recommendation_candidates','recommendation_outcomes','recommendation_metrics','recommendation_candidate_pool_v1','delete_recommendation_data_v1','queue_embedding_regeneration_v1','activate_recommendation_ranking_v1','rules_holdout','vector_similarity','feature_flags','ai_writing_enabled','ai_social_caption_enabled']) if (!migration.includes(marker)) throw new Error(`Stage 8 migration is missing ${marker}`)
for (const marker of ['recommendation_context_events','contextual_intent_bucket_v1','contextualCategory','contextualPrice','contextualAmenities','contextualDistanceKm','contextual-v2']) if (!migration.includes(marker)) throw new Error(`Contextual recommendation learning is missing ${marker}`)
for (const marker of ['complete_ai_assistance_v1','claim_embedding_jobs_v1','store_embedding_job_v1','fail_embedding_job_v1']) if (!migration.includes(`grant execute on function public.${marker}`) || !migration.includes('to service_role')) throw new Error(`Stage 8 worker authorization is missing ${marker}`)

const provider = await readFile(join(root, 'lib/ai/local-provider.js'), 'utf8')
if (provider.includes('authorization') || provider.includes('api-key') || provider.includes('x-api-key')) throw new Error('Local model provider must not send an external API credential')
for (const host of ['api.openai.com','api.anthropic.com','generativelanguage.googleapis.com','api.cohere.com','api.voyageai.com']) if (!provider.includes(host)) throw new Error(`Local provider does not block ${host}`)

const grounding = await readFile(join(root, 'lib/ai/grounding.js'), 'utf8')
for (const protectedFact of ['performers','schedules','prices','addresses','amenities','accessibility features','refund rules','age restrictions','sponsors']) if (!grounding.toLowerCase().includes(protectedFact)) throw new Error(`Grounding prompt is missing ${protectedFact}`)
const discovery = await readFile(join(root, 'lib/app/discovery.js'), 'utf8')
for (const marker of ['recommendation_candidate_pool_v1','scoreHybridCandidate','RULES_FALLBACK_VERSION','recommendation_candidates','impressionKey']) if (!discovery.includes(marker)) throw new Error(`Hybrid discovery is missing ${marker}`)
const ranking = await readFile(join(root, 'lib/app/hybrid-recommendations.js'), 'utf8')
for (const marker of ['recommendationIntentBucket','contextualCategory','contextualPrice','contextualAmenities','contextualDistance','contextual-v2']) if (!ranking.includes(marker)) throw new Error(`Contextual ranking is missing ${marker}`)
const docs = await readFile(join(root, 'docs/STAGE_8_SETUP.md'), 'utf8')
if (!docs.includes('does not deploy to, verify, or trigger Vercel')) throw new Error('Stage 8 setup must preserve the no-Vercel requirement')
console.log('Puddle Stage 8 validation checks passed.')
