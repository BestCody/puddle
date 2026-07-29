const BLOCKED_HOSTS = new Set([
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.cohere.com',
  'api.voyageai.com',
  'ollama.com'
])

function positiveInteger(value, fallback, min, max) {
  const number = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}

export function getLocalAiConfig() {
  const raw = String(process.env.LOCAL_AI_BASE_URL || '').trim()
  if (!raw) return { configured: false, reason: 'LOCAL_AI_BASE_URL is not configured.' }

  let url
  try {
    url = new URL(raw)
  } catch {
    return { configured: false, reason: 'LOCAL_AI_BASE_URL is invalid.' }
  }
  if (!['http:', 'https:'].includes(url.protocol) || BLOCKED_HOSTS.has(url.hostname.toLowerCase())) {
    return { configured: false, reason: 'Only a self-hosted local model endpoint is allowed.' }
  }

  return {
    configured: true,
    baseUrl: url.toString().replace(/\/$/, ''),
    generationModel: String(process.env.LOCAL_AI_GENERATION_MODEL || 'gemma3:4b').trim(),
    generationModelVersion: String(process.env.LOCAL_AI_GENERATION_MODEL_VERSION || process.env.LOCAL_AI_GENERATION_MODEL || 'gemma3:4b').trim(),
    embeddingModel: String(process.env.LOCAL_AI_EMBEDDING_MODEL || 'embeddinggemma').trim(),
    embeddingModelVersion: String(process.env.LOCAL_AI_EMBEDDING_MODEL_VERSION || process.env.LOCAL_AI_EMBEDDING_MODEL || 'embeddinggemma').trim(),
    dimensions: positiveInteger(process.env.LOCAL_AI_EMBEDDING_DIMENSIONS, 768, 768, 768),
    timeoutMs: positiveInteger(process.env.LOCAL_AI_TIMEOUT_MS, 45000, 2000, 120000)
  }
}

async function requestJson(url, payload, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: 'no-store'
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`Local model returned ${response.status}.`)
    return result
  } finally {
    clearTimeout(timer)
  }
}

export async function generateLocalJson({ system, prompt }) {
  const config = getLocalAiConfig()
  if (!config.configured) throw new Error(config.reason)
  const result = await requestJson(`${config.baseUrl}/api/generate`, {
    model: config.generationModel,
    system,
    prompt,
    stream: false,
    think: false,
    format: 'json',
    options: { temperature: 0.15, top_p: 0.85 }
  }, config.timeoutMs)

  const raw = String(result.response || '').trim()
  if (!raw) throw new Error('The local model returned an empty response.')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('The local model did not return valid JSON.')
  }
  return {
    output: parsed,
    provider: 'local_ollama',
    model: config.generationModel,
    modelVersion: config.generationModelVersion,
    durationMs: Math.max(0, Math.round(Number(result.total_duration || 0) / 1_000_000))
  }
}

export async function embedLocalTexts(inputs) {
  const config = getLocalAiConfig()
  if (!config.configured) throw new Error(config.reason)
  const values = Array.isArray(inputs) ? inputs : [inputs]
  if (!values.length || values.length > 100) throw new Error('Embedding batch size is invalid.')
  const result = await requestJson(`${config.baseUrl}/api/embed`, {
    model: config.embeddingModel,
    input: values.map((value) => String(value || '').slice(0, 12000)),
    truncate: true,
    dimensions: config.dimensions,
    keep_alive: '10m'
  }, Math.max(config.timeoutMs, 120000))
  const embeddings = Array.isArray(result.embeddings) ? result.embeddings : []
  if (embeddings.length !== values.length || embeddings.some((vector) => !Array.isArray(vector) || vector.length !== config.dimensions || vector.some((entry) => !Number.isFinite(Number(entry))))) {
    throw new Error(`The local embedding model must return ${config.dimensions}-dimension vectors.`)
  }
  return {
    embeddings: embeddings.map((vector) => vector.map(Number)),
    provider: 'local_ollama',
    model: config.embeddingModel,
    modelVersion: config.embeddingModelVersion,
    dimensions: config.dimensions
  }
}
