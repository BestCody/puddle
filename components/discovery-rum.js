"use client"

import { track } from '@vercel/analytics'

const DISCOVERY_RUM_SAMPLE_RATE = 0.1
const MAX_RUM_DURATION_MS = 120_000
const REGION_PATTERN = /^[a-z0-9-]{1,32}$/i
const PHASES = new Set(['navigation', 'continuation', 'prefetch', 'refresh'])
const OUTCOMES = new Set(['ok', 'http_error', 'network_error'])

function boundedMilliseconds(value) {
  const duration = Number(value)
  if (!Number.isFinite(duration) || duration < 0) return null
  return Math.min(MAX_RUM_DURATION_MS, Math.round(duration))
}

function safeRegion(value) {
  const region = String(value || '').trim()
  return REGION_PATTERN.test(region) ? region : 'unknown'
}

function safeStatus(value) {
  const status = Number(value)
  return Number.isInteger(status) && status >= 0 && status <= 599 ? status : 0
}

export function parseDiscoveryServerTiming(value) {
  const timings = {}
  for (const entry of String(value || '').split(',')) {
    const match = entry.trim().match(/^([A-Za-z0-9_-]+)(?:;[^,]*?dur=([0-9.]+))?$/)
    if (!match || !Number.isFinite(Number(match[2]))) continue
    timings[match[1]] = Number(match[2])
  }
  return timings
}

export function reportDiscoveryRum({
  phase,
  durationMs,
  headersMs = null,
  status = 0,
  region = 'unknown',
  outcome = 'ok',
  serverTiming = {}
}) {
  if (typeof window === 'undefined' || !PHASES.has(phase) || Math.random() >= DISCOVERY_RUM_SAMPLE_RATE) return

  const duration = boundedMilliseconds(durationMs)
  if (duration === null) return

  const properties = {
    phase,
    outcome: OUTCOMES.has(outcome) ? outcome : 'network_error',
    duration_ms: duration,
    status: safeStatus(status),
    region: safeRegion(region)
  }
  const headers = boundedMilliseconds(headersMs)
  if (headers !== null) properties.headers_ms = headers

  for (const name of ['auth', 'search', 'seen', 'query', 'total']) {
    const timing = boundedMilliseconds(serverTiming?.[name])
    if (timing !== null) properties[`server_${name}_ms`] = timing
  }

  const connection = String(window.navigator?.connection?.effectiveType || '').trim()
  if (connection) properties.connection = connection.slice(0, 16)
  track('discovery_rum', properties)
}

export async function timedDiscoveryRequest(request, { phase, region }) {
  const startedAt = window.performance.now()
  let status = 0
  try {
    const response = await request()
    status = response.status
    const headersMs = window.performance.now() - startedAt
    const result = (await response.json().catch(() => ({}))) || {}
    reportDiscoveryRum({
      phase,
      durationMs: window.performance.now() - startedAt,
      headersMs,
      status,
      region: response.headers.get('x-puddle-region') || region,
      outcome: response.ok ? 'ok' : 'http_error',
      serverTiming: parseDiscoveryServerTiming(response.headers.get('server-timing'))
    })
    return { response, result }
  } catch {
    reportDiscoveryRum({
      phase,
      durationMs: window.performance.now() - startedAt,
      status,
      region,
      outcome: 'network_error'
    })
    throw error
  }
}

export function reportInitialDiscoveryNavigation(region) {
  const entry = window.performance.getEntriesByType('navigation')[0]
  if (!entry) return
  reportDiscoveryRum({
    phase: 'navigation',
    durationMs: entry.duration,
    headersMs: entry.responseStart,
    status: 200,
    region,
    outcome: 'ok'
  })
}
