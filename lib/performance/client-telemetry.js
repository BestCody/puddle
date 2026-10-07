const VITAL_NAMES = new Set(['TTFB', 'FCP', 'LCP', 'CLS', 'INP', 'FID'])
const ROUTE_GROUPS = new Set(['home', 'discover', 'map', 'saved', 'profile', 'friends', 'messages', 'pass', 'places', 'other'])
const DISCOVERY_PHASES = new Set(['navigation', 'continuation', 'prefetch', 'refresh'])
const DISCOVERY_OUTCOMES = new Set(['ok', 'http_error', 'network_error'])

function boundedNumber(value, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum
    ? Math.round(value * 10_000) / 10_000
    : null
}

export function telemetryRouteGroup(pathname) {
  const segment = String(pathname || '').split('/')[1]
  if (!segment) return 'home'
  if (segment === 'plans') return 'saved'
  if (segment === 'matches') return 'friends'
  if (segment === 'membership') return 'pass'
  return ROUTE_GROUPS.has(segment) ? segment : 'other'
}

export function shouldReportClientTelemetry(pathname) {
  const path = String(pathname || '')
  return path !== '/landing-demo' && !path.startsWith('/landing-demo/')
}

export function normalizeClientTelemetry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  if (input.event === 'page_view') {
    if (!ROUTE_GROUPS.has(input.route)) return null
    return { event: 'page_view', route: input.route }
  }
  if (input.event === 'web_vital') {
    const value = boundedNumber(input.value, 120_000)
    if (!VITAL_NAMES.has(input.name) || value === null || !ROUTE_GROUPS.has(input.route)) return null
    return { event: 'web_vital', route: input.route, name: input.name, value }
  }
  if (input.event === 'discovery_rum') {
    const duration = boundedNumber(input.duration_ms, 120_000)
    const status = input.status
    if (!DISCOVERY_PHASES.has(input.phase) || !DISCOVERY_OUTCOMES.has(input.outcome) || duration === null || !Number.isInteger(status) || status < 0 || status > 599) return null
    const result = { event: 'discovery_rum', phase: input.phase, outcome: input.outcome, duration_ms: duration, status }
    for (const name of ['headers_ms', 'server_auth_ms', 'server_search_ms', 'server_seen_ms', 'server_query_ms', 'server_total_ms']) {
      const value = boundedNumber(input[name], 120_000)
      if (value !== null && input[name] !== null && input[name] !== undefined) result[name] = value
    }
    if (typeof input.region === 'string' && /^[a-z0-9-]{1,32}$/i.test(input.region)) result.region = input.region
    if (typeof input.connection === 'string' && /^[a-z0-9-]{1,16}$/i.test(input.connection)) result.connection = input.connection
    return result
  }
  return null
}
