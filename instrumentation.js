import { createTraceId, recordSloObservation } from './lib/performance/server-latency.js'

// The private object store is the only runtime location-serving backend.

export async function register() {
  console.info('[puddle_observability]', JSON.stringify({
    event: 'puddle_observability_boot',
    service: 'self-hosted',
    region: process.env.PUDDLE_REGION || 'local',
    location_search_backend: 'object-store'
  }))
}

export function onRequestError(error, request, context) {
  const traceId = createTraceId()
  const route = context?.routePath || context?.routeType || 'unknown'
  recordSloObservation('requestError', 0, false, {
    trace_id: traceId,
    service: 'self-hosted',
    route: String(route).slice(0, 160),
    method: String(request?.method || '').slice(0, 12),
    error_name: String(error?.name || 'Error').slice(0, 120),
    error_digest: String(error?.digest || '').slice(0, 160) || null
  })
}
