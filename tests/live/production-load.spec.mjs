import { expect, test } from '@playwright/test'

const BENCHMARK_ORIGIN = 'https://puddle-gch8ozxsf-bestcodys-projects.vercel.app'
const ACCESS_URL = 'https://puddle-gch8ozxsf-bestcodys-projects.vercel.app/?_vercel_share=j2stenNAk5Q8oEQc4fNVmYwqqjrzolch'

const TARGETS = [
  { label: 'Discover', path: '/map' },
  { label: 'Saved', path: '/plans' },
  { label: 'Friends', path: '/matches' },
  { label: 'Pass', path: '/membership' },
  { label: 'Profile', path: '/profile' },
  { label: 'Swipe', path: '/discover' }
]

const ROUNDS = 4

async function deleteDisposableAccount(page) {
  try {
    await page.goto(`${BENCHMARK_ORIGIN}/account`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    if (!/\/account(?:\?|$)/.test(page.url())) return
    const confirmation = page.getByLabel('Confirmation')
    if (!(await confirmation.isVisible().catch(() => false))) return
    await confirmation.fill('DELETE')
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/' && url.searchParams.get('account') === 'deleted', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Delete my account' }).click()
    ])
  } catch {
    // Cleanup remains best-effort; benchmark output is authoritative.
  }
}

async function createDisposableAccount(page) {
  const suffix = `${Date.now().toString(36)}${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`
  const email = `puddle-nav-bench-old-${suffix}@example.com`
  const password = `NavBench-${suffix}-A9!`
  const username = `nav_${suffix}`.slice(0, 24)

  await page.goto(ACCESS_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })

  await page.route('**/api/location/search?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{
          providerId: 'nav-bench-toronto',
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

  await page.goto(`${BENCHMARK_ORIGIN}/signup`)
  await page.getByLabel('Display name').fill('Puddle Navigation Benchmark Old')
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
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1))
  return sorted[index]
}

function summarize(values) {
  return {
    samples: values.length,
    p50_ms: Math.round(percentile(values, 0.50)),
    p95_ms: Math.round(percentile(values, 0.95)),
    p99_ms: Math.round(percentile(values, 0.99)),
    min_ms: Math.round(Math.min(...values)),
    max_ms: Math.round(Math.max(...values)),
    mean_ms: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  }
}

test('measure authenticated production client navigation latency', async ({ page }) => {
  test.setTimeout(240_000)
  let accountCreated = false
  try {
    await createDisposableAccount(page)
    accountCreated = true

    const samples = []
    for (let round = 1; round <= ROUNDS; round += 1) {
      for (const target of TARGETS) {
        const link = page.getByRole('link', { name: target.label, exact: true })
        await expect(link).toBeVisible()

        const started = performance.now()
        await link.click()
        await page.waitForURL((url) => url.pathname === target.path, { timeout: 20_000 })
        const urlMs = performance.now() - started
        await page.locator('.puddle-main-transition-loader').waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {})
        const settledMs = performance.now() - started

        samples.push({ round, label: target.label, path: target.path, urlMs, settledMs })
        console.info(JSON.stringify({
          event: 'puddle_navigation_benchmark_sample',
          round,
          target: target.path,
          url_ms: Math.round(urlMs),
          settled_ms: Math.round(settledMs)
        }))
        await page.waitForTimeout(100)
      }
    }

    const urlValues = samples.map((sample) => sample.urlMs)
    const settledValues = samples.map((sample) => sample.settledMs)
    const byRoute = Object.fromEntries(TARGETS.map((target) => {
      const routeSamples = samples.filter((sample) => sample.path === target.path)
      return [target.path, {
        url: summarize(routeSamples.map((sample) => sample.urlMs)),
        settled: summarize(routeSamples.map((sample) => sample.settledMs))
      }]
    }))

    console.info(JSON.stringify({
      event: 'puddle_navigation_benchmark_summary',
      benchmark_origin: BENCHMARK_ORIGIN,
      rounds: ROUNDS,
      transitions: samples.length,
      url: summarize(urlValues),
      settled: summarize(settledValues),
      by_route: byRoute
    }))

    expect(samples).toHaveLength(ROUNDS * TARGETS.length)
  } finally {
    if (accountCreated) await deleteDisposableAccount(page)
  }
})
