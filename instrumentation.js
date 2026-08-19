import { createTraceId, recordSloObservation } from './lib/performance/server-latency.js'

export function normalizeOpenSearchRuntimeEnv(env = process.env) {
  if (!env.GLOBAL_LOCATION_SEARCH_URL && env.OPENSEARCH_HOST) {
    env.GLOBAL_LOCATION_SEARCH_URL = env.OPENSEARCH_HOST
  }
  if (!env.OPENSEARCH_USERNAME && env.OPENSEARCH_USER) {
    env.OPENSEARCH_USERNAME = env.OPENSEARCH_USER
  }

  const hasBearer = Boolean(String(env.OPENSEARCH_BEARER_TOKEN || '').trim())
  const hasUsername = Boolean(String(env.OPENSEARCH_USERNAME || '').trim())
  const hasPassword = Boolean(String(env.OPENSEARCH_PASSWORD || '').trim())
  const authMode = hasBearer
    ? 'bearer'
    : hasUsername && hasPassword
      ? 'basic'
      : hasUsername || hasPassword
        ? 'partial-basic'
        : 'none'

  return {
    endpointConfigured: Boolean(String(env.GLOBAL_LOCATION_SEARCH_URL || env.OPENSEARCH_URL || '').trim()),
    authMode,
    usernameConfigured: hasUsername,
    passwordConfigured: hasPassword
  }
}

export async function hydrateOpenSearchRuntimeAuthFromVault(env = process.env, { fetchFn = fetch } = {}) {
  const current = normalizeOpenSearchRuntimeEnv(env)
  if (current.authMode === 'basic' || current.authMode === 'bearer') {
    return { loaded: false, source: 'environment' }
  }

  const supabaseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '')
  const serviceKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!supabaseUrl || !serviceKey) return { loaded: false, source: 'none' }

  const response = await fetchFn(`${supabaseUrl}/rest/v1/rpc/get_opensearch_runtime_auth`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: '{}',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(5000)
  })
  if (!response.ok) throw new Error(`OpenSearch Vault credential lookup returned HTTP ${response.status}.`)

  const payload = await response.json()
  const username = String(payload?.username || '').trim()
  const password = String(payload?.password || '')
  if (!username || !password) throw new Error('OpenSearch Vault credential is unavailable.')

  env.OPENSEARCH_USERNAME = username
  env.OPENSEARCH_PASSWORD = password
  return { loaded: true, source: 'supabase-vault' }
}

export async function register() {
  const searchBackend = String(process.env.GLOBAL_LOCATION_SEARCH_BACKEND || 'opensearch').trim().toLowerCase()
  let authSource = searchBackend === 'opensearch' ? 'environment' : 'not-required'
  let openSearch = normalizeOpenSearchRuntimeEnv()

  if (
    searchBackend === 'opensearch' &&
    process.env.NEXT_RUNTIME !== 'edge' &&
    openSearch.endpointConfigured &&
    !['basic', 'bearer'].includes(openSearch.authMode)
  ) {
    try {
      const hydrated = await hydrateOpenSearchRuntimeAuthFromVault()
      authSource = hydrated.source
      openSearch = normalizeOpenSearchRuntimeEnv()
    } catch (error) {
      authSource = 'vault-error'
      console.error(`[puddle_observability] OpenSearch runtime auth hydration failed: ${error?.message || 'unknown error'}`)
    }
  }

  console.info('[puddle_observability]', JSON.stringify({
    event: 'puddle_observability_boot',
    service: 'vercel',
    region: process.env.VERCEL_REGION || 'local',
    location_search_backend: searchBackend,
    opensearch_endpoint_configured: openSearch.endpointConfigured,
    opensearch_auth_mode: openSearch.authMode,
    opensearch_auth_source: authSource,
    opensearch_username_configured: openSearch.usernameConfigured,
    opensearch_password_configured: openSearch.passwordConfigured
  }))
}

export function onRequestError(error, request, context) {
  const traceId = createTraceId()
  const route = context?.routePath || context?.routeType || 'unknown'
  recordSloObservation('requestError', 0, false, {
    trace_id: traceId,
    service: 'vercel',
    route: String(route).slice(0, 160),
    method: String(request?.method || '').slice(0, 12),
    error_name: String(error?.name || 'Error').slice(0, 120),
    error_digest: String(error?.digest || '').slice(0, 160) || null
  })
}
