import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { normalizeClientTelemetry, shouldReportClientTelemetry, telemetryRouteGroup } from '../../lib/performance/client-telemetry.js'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('first-party telemetry groups routes without transmitting user paths or query strings', () => {
  assert.equal(telemetryRouteGroup('/places/in/toronto?q=private'), 'places')
  assert.equal(telemetryRouteGroup('/plans'), 'saved')
  assert.equal(telemetryRouteGroup('/'), 'home')
  assert.deepEqual(normalizeClientTelemetry({ event: 'page_view', route: 'places', email: 'ignored@example.com' }), {
    event: 'page_view', route: 'places'
  })
  assert.equal(normalizeClientTelemetry({ event: 'page_view', route: '/profile/secret' }), null)
})

test('landing phone iframes do not generate extra page-view or vital samples', async () => {
  assert.equal(shouldReportClientTelemetry('/landing-demo/swipe'), false)
  assert.equal(shouldReportClientTelemetry('/landing-demo/feed'), false)
  assert.equal(shouldReportClientTelemetry('/landing-demo-other'), true)
  assert.equal(shouldReportClientTelemetry('/discover'), true)
  const client = await read('components/client-telemetry.js')
  assert.match(client, /if \(!shouldReportClientTelemetry\(window\.location\.pathname\)\) return/)
  assert.match(client, /if \(!shouldReportClientTelemetry\(pathname\)\) return/)
})

test('first-party telemetry accepts only bounded known metrics and discovery phases', () => {
  assert.deepEqual(normalizeClientTelemetry({ event: 'web_vital', route: 'discover', name: 'LCP', value: 1234.567, user_id: 'ignored' }), {
    event: 'web_vital', route: 'discover', name: 'LCP', value: 1234.567
  })
  assert.equal(normalizeClientTelemetry({ event: 'web_vital', route: 'discover', name: 'LCP', value: -1 }), null)
  assert.equal(normalizeClientTelemetry({ event: 'web_vital', route: 'discover', name: 'custom', value: 100 }), null)
  assert.deepEqual(normalizeClientTelemetry({ event: 'discovery_rum', phase: 'prefetch', outcome: 'ok', duration_ms: 120, status: 200, server_search_ms: 20, email: 'ignored' }), {
    event: 'discovery_rum', phase: 'prefetch', outcome: 'ok', duration_ms: 120, status: 200, server_search_ms: 20
  })
  assert.equal(normalizeClientTelemetry({ event: 'discovery_rum', phase: 'unknown', outcome: 'ok', duration_ms: 120, status: 200 }), null)
})

test('the telemetry route is same-origin, small, uncached and avoids auth database reads', async () => {
  const [route, proxy, layout, client] = await Promise.all([
    read('app/api/telemetry/route.js'),
    read('proxy.js'),
    read('app/layout.js'),
    read('components/client-telemetry.js')
  ])
  assert.match(route, /applicationOrigin\(request\)/)
  assert.match(route, /MAX_BODY_BYTES = 2_048/)
  assert.match(route, /Cache-Control': 'no-store'/)
  assert.match(route, /acceptedInWindow\+\+ < 1_200/)
  assert.match(proxy, /'\/api\/telemetry'/)
  assert.match(layout, /<ClientTelemetry \/>/)
  assert.match(client, /useReportWebVitals\(reportWebVital\)/)
  assert.doesNotMatch(layout, /@vercel\//)
})
