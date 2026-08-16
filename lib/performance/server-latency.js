export const SERVER_LATENCY_BUDGET_MS = Object.freeze({
  proxyClaims: 90,
  proxyModerationProfile: 160,
  proxySession: 250,
  dashboardBootstrap: 180
})

export function latencyStart() {
  return Date.now()
}

export function elapsedMs(startedAt) {
  return Math.max(0, Date.now() - Number(startedAt || Date.now()))
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

export function appendServerTiming(response, timings = []) {
  if (!response?.headers || !Array.isArray(timings) || !timings.length) return response
  const safe = timings
    .filter((entry) => entry?.name && Number.isFinite(Number(entry.durationMs)))
    .map((entry) => `${String(entry.name).replace(/[^a-zA-Z0-9_-]/g, '')};dur=${Number(entry.durationMs).toFixed(0)}`)
  if (safe.length) response.headers.set('Server-Timing', safe.join(', '))
  return response
}
