import { createTraceId, recordSloObservation } from './lib/performance/server-latency.js'

export async function register() {
  console.info('[puddle_observability]', JSON.stringify({
    event: 'puddle_observability_boot',
    service: 'vercel',
    region: process.env.VERCEL_REGION || 'local',
    location_search_backend: 'b2'
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
