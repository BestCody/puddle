import { randomBytes } from 'node:crypto'

export const SERVER_LATENCY_BUDGET_MS = Object.freeze({
  proxyClaims: 90,
  proxyModerationProfile: 160,
  proxySession: 250,
  pageAuthUser: 160,
  pageProfile: 180,
  pageSession: 320,
  dashboardBootstrap: 180,
  supabaseQuery: 350,
  openSearch: 500,
  discovery: 750,
  mapViewport: 650,
  socialFeed: 750,
  savedHistory: 650,
  locationDetail: 700
})

export const PRODUCTION_SLOS = Object.freeze({
  discovery: { availability: 0.995, p95Ms: 750 },
  mapViewport: { availability: 0.995, p95Ms: 650 },
  socialFeed: { availability: 0.995, p95Ms: 750 },
  savedHistory: { availability: 0.995, p95Ms: 650 },
  locationDetail: { availability: 0.995, p95Ms: 700 },
  openSearch: { availability: 0.995, p95Ms: 500 },
  supabase: { availability: 0.999, p95Ms: 350 }
})

export function latencyStart() {
  return Date.now()
}

export function elapsedMs(startedAt) {
  return Math.max(0, Date.now() - Number(startedAt || Date.now()))
}

export function createTraceId() {
  return randomBytes(16).toString('hex')
}

export function traceparent(traceId, spanId = randomBytes(8).toString('hex')) {
  const trace = String(traceId || '').replace(/[^0-9a-f]/gi, '').slice(0, 32).padStart(32, '0')
  const span = String(spanId || '').replace(/[^0-9a-f]/gi, '').slice(0, 16).padStart(16, '0')
  return `00-${trace}-${span}-01`
}

export function recordServerLatency(name, durationMs, budgetMs, metadata = {}) {
  const duration = Number(durationMs || 0)
  const budget = Number(budgetMs || 0)
  const payload = {
    event: 'puddle_server_latency',
    metric: String(name || 'unknown'),
    duration_ms: duration,
    budget_ms: budget || null,
    over_budget: Boolean(budget && duration > budget),
    region: process.env.VERCEL_REGION || 'local',
    ...metadata
  }
  const logger = payload.over_budget ? console.warn : console.info
  logger('[puddle_latency]', JSON.stringify(payload))
  return payload
}

export function recordSloObservation(operation, durationMs, success = true, metadata = {}) {
  const target = PRODUCTION_SLOS[operation] || (
    metadata.service === 'supabase' ? PRODUCTION_SLOS.supabase :
      metadata.service === 'opensearch' ? PRODUCTION_SLOS.openSearch : null
  )
  const duration = Math.max(0, Number(durationMs) || 0)
  const payload = {
    event: 'puddle_slo_observation',
    operation: String(operation || 'unknown'),
    service: metadata.service || 'vercel',
    success: Boolean(success),
    duration_ms: duration,
    target_p95_ms: target?.p95Ms || null,
    target_availability: target?.availability || null,
    over_target: Boolean(target?.p95Ms && duration > target.p95Ms),
    region: process.env.VERCEL_REGION || 'local',
    ...metadata
  }
  const logger = !payload.success || payload.over_target ? console.warn : console.info
  logger('[puddle_slo]', JSON.stringify(payload))
  return payload
}

export async function traceServerOperation(operation, fn, {
  service = 'vercel',
  traceId = createTraceId(),
  budgetMs = null,
  metadata = {}
} = {}) {
  const started = latencyStart()
  try {
    const value = await fn()
    const durationMs = elapsedMs(started)
    recordServerLatency(`${service}.${operation}`, durationMs, budgetMs || SERVER_LATENCY_BUDGET_MS[operation], {
      trace_id: traceId,
      service,
      operation,
      ...metadata
    })
    recordSloObservation(operation, durationMs, true, { trace_id: traceId, service, ...metadata })
    return value
  } catch (error) {
    const durationMs = elapsedMs(started)
    recordServerLatency(`${service}.${operation}`, durationMs, budgetMs || SERVER_LATENCY_BUDGET_MS[operation], {
      trace_id: traceId,
      service,
      operation,
      failed: true,
      ...metadata
    })
    recordSloObservation(operation, durationMs, false, { trace_id: traceId, service, ...metadata })
    throw error
  }
}

export function appendServerTiming(response, timings = []) {
  if (!response?.headers || !Array.isArray(timings) || !timings.length) return response
  const safe = timings
    .filter((entry) => entry?.name && Number.isFinite(Number(entry.durationMs)))
    .map((entry) => `${String(entry.name).replace(/[^a-zA-Z0-9_-]/g, '')};dur=${Number(entry.durationMs).toFixed(0)}`)
  if (safe.length) response.headers.set('Server-Timing', safe.join(', '))
  return response
}
