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

export function register() {
  const openSearch = normalizeOpenSearchRuntimeEnv()
  console.info('[puddle_observability]', JSON.stringify({
    event: 'puddle_observability_boot',
    service: 'vercel',
    region: process.env.VERCEL_REGION || 'local',
    opensearch_endpoint_configured: openSearch.endpointConfigured,
    opensearch_auth_mode: openSearch.authMode,
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
