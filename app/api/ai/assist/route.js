import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { buildCreationPrompt, deterministicAssist, moderateCreationInput, normalizeCreationOutput, sanitizeSourceFields, validateGrounding } from '@/lib/ai/grounding'
import { generateLocalJson, getLocalAiConfig } from '@/lib/ai/local-provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KINDS = new Set(['event', 'location'])
const PURPOSES = new Set(['title','short_description','description','categories_tags','accessibility_prompts','social_caption','missing_information'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RULE_PURPOSES = new Set(['categories_tags','accessibility_prompts','missing_information'])

function safeError(error, fallback = 'Creation assistance is temporarily unavailable.') {
  const message = String(error?.message || '').trim().slice(0, 240)
  return message && !/policy|schema|relation|column|constraint|supabase|service role/i.test(message) ? message : fallback
}

async function complete(admin, args) {
  const { error } = await admin.rpc('complete_ai_assistance_v1', args)
  if (error) throw error
}

export async function POST(request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Creation assistance is unavailable.' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to use creation assistance.' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const contentKind = String(body.contentKind || '')
  const contentId = UUID.test(String(body.contentId || '')) ? String(body.contentId) : null
  const purpose = String(body.purpose || '')
  if (!KINDS.has(contentKind) || !PURPOSES.has(purpose)) return NextResponse.json({ error: 'That creation-assistance request is invalid.' }, { status: 400 })

  const source = sanitizeSourceFields(contentKind, body.sourceFields)
  if (!Object.keys(source).length) return NextResponse.json({ error: 'Add some draft facts before requesting assistance.' }, { status: 400 })

  const moderation = moderateCreationInput(source)
  const { system, prompt, deterministic } = buildCreationPrompt({ contentKind, purpose, source })
  const localConfig = getLocalAiConfig()
  const useRules = RULE_PURPOSES.has(purpose) && !localConfig.configured
  const provider = useRules ? 'rules' : 'local_ollama'
  const model = useRules ? 'puddle-deterministic-v1' : localConfig.generationModel
  const modelVersion = useRules ? 'stage8-v1' : localConfig.generationModelVersion

  let runId
  try {
    const reservation = await supabase.rpc('reserve_ai_assistance_v1', {
      target_kind: contentKind,
      target_id: contentId,
      request_purpose: purpose,
      source_data: source,
      prompt_text: prompt,
      provider_name: provider,
      model_name: model,
      model_revision: modelVersion,
      prompt_revision: 'stage8-grounded-v1'
    })
    if (reservation.error || !reservation.data) throw reservation.error || new Error('The assistance request could not be reserved.')
    runId = reservation.data
    const admin = createAdminClient()

    if (!moderation.allowed) {
      await complete(admin, { target_run: runId, result_output: null, moderation_result: moderation, grounding_result: {}, final_status: 'blocked', elapsed_ms: 0, failure_category: 'moderation_block' })
      return NextResponse.json({ error: 'This draft needs moderation review before assistance can run.', runId, moderation }, { status: 422 })
    }

    if (useRules) {
      const output = deterministicAssist(contentKind, source)
      await complete(admin, { target_run: runId, result_output: output, moderation_result: moderation, grounding_result: { allowed: true, mode: 'rules' }, final_status: 'generated', elapsed_ms: 0, failure_category: null })
      return NextResponse.json({ runId, output, provider, model, requiresHumanReview: true, localModelConfigured: false })
    }
    if (!localConfig.configured) throw new Error('Configure a self-hosted local model before using writing assistance.')

    const generated = await generateLocalJson({ system, prompt })
    const output = normalizeCreationOutput(contentKind, generated.output, deterministic)
    const outputModeration = moderateCreationInput(output)
    const combinedModeration = { allowed: moderation.allowed && outputModeration.allowed, input: moderation, output: outputModeration }
    if (!outputModeration.allowed) {
      await complete(admin, { target_run: runId, result_output: output, moderation_result: combinedModeration, grounding_result: {}, final_status: 'blocked', elapsed_ms: generated.durationMs, failure_category: 'output_moderation_block' })
      return NextResponse.json({ error: 'The local model output was blocked by moderation.', runId, moderation: combinedModeration }, { status: 422 })
    }
    const grounding = validateGrounding(source, output)
    if (!grounding.allowed) {
      await complete(admin, { target_run: runId, result_output: output, moderation_result: combinedModeration, grounding_result: grounding, final_status: 'blocked', elapsed_ms: generated.durationMs, failure_category: 'unsupported_factual_claim' })
      return NextResponse.json({ error: 'The local model added unsupported factual details, so the suggestion was blocked.', runId, grounding }, { status: 422 })
    }

    await complete(admin, { target_run: runId, result_output: output, moderation_result: combinedModeration, grounding_result: grounding, final_status: 'generated', elapsed_ms: generated.durationMs, failure_category: null })
    return NextResponse.json({ runId, output, provider: generated.provider, model: generated.model, modelVersion: generated.modelVersion, requiresHumanReview: true, localModelConfigured: true })
  } catch (error) {
    if (runId) {
      try {
        const admin = createAdminClient()
        await complete(admin, { target_run: runId, result_output: null, moderation_result: moderation, grounding_result: {}, final_status: 'failed', elapsed_ms: null, failure_category: /abort/i.test(String(error?.name)) ? 'timeout' : 'provider_unavailable' })
      } catch {}
    }
    return NextResponse.json({ error: safeError(error) }, { status: /limit reached/i.test(String(error?.message)) ? 429 : 503 })
  }
}
