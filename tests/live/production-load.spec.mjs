import { expect, test } from '@playwright/test'

const STAGES = [5, 10, 20]
const MIN_SUCCESS_RATE = 0.99
const P95_LIMIT_MS = {
  discovery: 2500,
  mapViewport: 2000,
  socialFeed: 3500,
  savedHistory: 3500,
  locationDetail: 3500
}

async function deleteDisposableAccount(page) {
  try {
    await page.goto('/account', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    if (!/\/account(?:\?|$)/.test(page.url())) return
    const confirmation = page.getByLabel('Confirmation')
    if (!(await confirmation.isVisible().catch(() => false))) return
    await confirmation.fill('DELETE')
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/' && url.searchParams.get('account') === 'deleted', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Delete my account' }).click()
    ])
  } catch {
    // Cleanup remains best-effort; the load assertions are authoritative.
  }
}

async function createDisposableAccount(page) {
  const suffix = `${Date.now().toString(36)}${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`
  const email = `puddle-load-${suffix}@example.com`
  const password = `LoadSmoke-${suffix}-A9!`
  const username = `load_${suffix}`.slice(0, 24)

  await page.route('**/api/location/search?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{
          providerId: 'load-smoke-toronto',
          city: 'Toronto',
          region: 'Ontario',
          country: 'Canada',
          countryCode: 'CA',
          latitude: 43.6532,
          longitude: -79.3832,
          timezone: 'America/Toronto',
          label: 'Toronto, Ontario, Canada'
        }]
      })
    })
  })

  await page.goto('/signup')
  await page.getByLabel('Display name').fill('Puddle Load Test')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('checkbox', { name: /confirm the information I/i }).check()
  await page.getByRole('button', { name: 'Create my Puddle →' }).click()
  await page.waitForURL(/\/onboarding(?:\?|$)/, { timeout: 30_000 })

  await page.locator('input[name="username"]').fill(username)
  await page.locator('input[name="birth_date"]').fill('1990-01-01')
  await page.getByLabel('City or town').fill('Toronto')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByRole('option').filter({ hasText: 'Toronto' }).click()
  await page.getByRole('checkbox', { name: 'Coffee shops' }).check()
  await page.getByRole('checkbox', { name: 'Restaurants' }).check()
  await page.getByRole('checkbox', { name: 'Parks & gardens' }).check()
  await page.getByRole('button', { name: 'Build my date deck →' }).click()
  await page.waitForURL(/\/discover(?:\?|$)/, { timeout: 30_000 })
}

function percentile(values, fraction) {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1))
  return sorted[index]
}

async function timedGet(request, path) {
  const started = performance.now()
  try {
    const response = await request.get(path, {
      headers: {
        'x-puddle-load-test': 'bounded-pr-gate'
      },
      timeout: 15_000
    })
    await response.body()
    return {
      ok: response.ok(),
      status: response.status(),
      durationMs: performance.now() - started,
      traceId: response.headers()['x-puddle-trace-id'] || null
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: performance.now() - started,
      error: String(error?.message || error)
    }
  }
}

async function runScenario(request, name, path) {
  const samples = []
  for (const concurrency of STAGES) {
    const batch = await Promise.all(Array.from({ length: concurrency }, () => timedGet(request, path)))
    samples.push(...batch.map((sample) => ({ ...sample, concurrency })))
  }

  const durations = samples.map((sample) => sample.durationMs)
  const successes = samples.filter((sample) => sample.ok).length
  const successRate = successes / samples.length
  const summary = {
    event: 'puddle_production_load_result',
    scenario: name,
    requests: samples.length,
    success_rate: successRate,
    p50_ms: Math.round(percentile(durations, 0.5)),
    p95_ms: Math.round(percentile(durations, 0.95)),
    p99_ms: Math.round(percentile(durations, 0.99)),
    status_counts: Object.fromEntries([...new Set(samples.map((sample) => sample.status))].map((status) => [
      String(status),
      samples.filter((sample) => sample.status === status).length
    ])),
    stages: STAGES
  }
  console.info(JSON.stringify(summary))

  expect(successRate, `${name} success rate`).toBeGreaterThanOrEqual(MIN_SUCCESS_RATE)
  expect(summary.p95_ms, `${name} p95`).toBeLessThanOrEqual(P95_LIMIT_MS[name])
  return summary
}

test('bounded production load gate covers all critical read paths', async ({ page }) => {
  test.setTimeout(240_000)
  let accountCreated = false
  try {
    await createDisposableAccount(page)
    accountCreated = true

    const discovery = await page.request.get('/api/discovery?limit=10', { timeout: 15_000 })
    expect(discovery.ok()).toBeTruthy()
    const discoveryPayload = await discovery.json()
    let detailPath = discoveryPayload?.items?.find((item) => item?.slug)?.slug
      ? `/plans/${discoveryPayload.items.find((item) => item?.slug).slug}`
      : null

    const map = await page.request.get('/api/map/viewport?north=43.78&south=43.55&east=-79.20&west=-79.62&zoom=11', { timeout: 15_000 })
    expect(map.ok()).toBeTruthy()
    const mapPayload = await map.json()
    if (!detailPath) detailPath = mapPayload?.points?.find((point) => point?.href)?.href || null
    expect(detailPath, 'location detail path from production discovery/map').toBeTruthy()

    await runScenario(page.request, 'discovery', '/api/discovery?limit=10')
    await runScenario(page.request, 'mapViewport', '/api/map/viewport?north=43.78&south=43.55&east=-79.20&west=-79.62&zoom=11')
    await runScenario(page.request, 'socialFeed', '/map')
    await runScenario(page.request, 'savedHistory', '/plans?tab=saved')
    await runScenario(page.request, 'locationDetail', detailPath)
  } finally {
    if (accountCreated) await deleteDisposableAccount(page)
  }
})
