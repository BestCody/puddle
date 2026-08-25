import { expect, test } from '@playwright/test'

const NEW_ORIGIN = 'https://puddle.you'
const OLD_ORIGIN = 'https://puddle-gch8ozxsf-bestcodys-projects.vercel.app'
const OLD_ACCESS_URL = 'https://puddle-gch8ozxsf-bestcodys-projects.vercel.app/?_vercel_share=j2stenNAk5Q8oEQc4fNVmYwqqjrzolch'

const TARGETS = [
  { label: 'Discover', path: '/map' },
  { label: 'Saved', path: '/plans' },
  { label: 'Friends', path: '/matches' },
  { label: 'Pass', path: '/membership' },
  { label: 'Profile', path: '/profile' },
  { label: 'Swipe', path: '/discover' }
]

const ROUNDS = 4

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

async function createDisposableAccount(page) {
  const suffix = `${Date.now().toString(36)}${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`
  const email = `puddle-nav-compare-${suffix}@example.com`
  const password = `NavCompare-${suffix}-A9!`
  const username = `nav_${suffix}`.slice(0, 24)

  await page.route('**/api/location/search?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{
          providerId: 'nav-compare-toronto',
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

  await page.goto(`${NEW_ORIGIN}/signup`)
  await page.getByLabel('Display name').fill('Puddle Navigation Comparison')
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
  return { email, password }
}

async function signInOldDeployment(page, email, password) {
  await page.goto(OLD_ACCESS_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.goto(`${OLD_ORIGIN}/signin?next=%2Fdiscover`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.getByLabel('Email').first().fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.waitForURL((url) => url.origin === OLD_ORIGIN && url.pathname === '/discover', { timeout: 30_000 })
}

async function deleteDisposableAccount(page) {
  try {
    await page.goto(`${NEW_ORIGIN}/account`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    if (new URL(page.url()).origin !== NEW_ORIGIN || !/\/account(?:\?|$)/.test(page.url())) return
    const confirmation = page.getByLabel('Confirmation')
    if (!(await confirmation.isVisible().catch(() => false))) return
    await confirmation.fill('DELETE')
    await Promise.all([
      page.waitForURL((url) => url.origin === NEW_ORIGIN && url.pathname === '/' && url.searchParams.get('account') === 'deleted', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Delete my account' }).click()
    ])
  } catch {
    // Cleanup remains best-effort; benchmark output is authoritative.
  }
}

async function measureNavigation(page, origin, version) {
  const samples = []
  for (let round = 1; round <= ROUNDS; round += 1) {
    for (const target of TARGETS) {
      const link = page.getByRole('link', { name: target.label, exact: true })
      await expect(link).toBeVisible()
      const started = performance.now()
      await link.click()
      await page.waitForURL((url) => url.origin === origin && url.pathname === target.path, { timeout: 20_000 })
      const urlMs = performance.now() - started
      await page.locator('.puddle-main-transition-loader').waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {})
      const settledMs = performance.now() - started
      samples.push({ round, path: target.path, urlMs, settledMs })
      console.info(JSON.stringify({ event: 'puddle_navigation_compare_sample', version, round, target: target.path, url_ms: Math.round(urlMs), settled_ms: Math.round(settledMs) }))
      await page.waitForTimeout(100)
    }
  }

  const byRoute = Object.fromEntries(TARGETS.map((target) => {
    const routeSamples = samples.filter((sample) => sample.path === target.path)
    return [target.path, {
      url: summarize(routeSamples.map((sample) => sample.urlMs)),
      settled: summarize(routeSamples.map((sample) => sample.settledMs))
    }]
  }))
  const summary = {
    version,
    origin,
    rounds: ROUNDS,
    transitions: samples.length,
    url: summarize(samples.map((sample) => sample.urlMs)),
    settled: summarize(samples.map((sample) => sample.settledMs)),
    by_route: byRoute
  }
  console.info(JSON.stringify({ event: 'puddle_navigation_compare_summary', ...summary }))
  return summary
}

test('compare pre-PR and merged authenticated navigation on one production account', async ({ page }) => {
  test.setTimeout(240_000)
  let accountCreated = false
  try {
    const credentials = await createDisposableAccount(page)
    accountCreated = true
    const current = await measureNavigation(page, NEW_ORIGIN, 'new')
    await signInOldDeployment(page, credentials.email, credentials.password)
    const old = await measureNavigation(page, OLD_ORIGIN, 'old')
    console.info(JSON.stringify({
      event: 'puddle_navigation_old_vs_new',
      old,
      new: current,
      p50_url_improvement_pct: Math.round((1 - current.url.p50_ms / old.url.p50_ms) * 1000) / 10,
      p95_url_improvement_pct: Math.round((1 - current.url.p95_ms / old.url.p95_ms) * 1000) / 10,
      p50_settled_improvement_pct: Math.round((1 - current.settled.p50_ms / old.settled.p50_ms) * 1000) / 10,
      p95_settled_improvement_pct: Math.round((1 - current.settled.p95_ms / old.settled.p95_ms) * 1000) / 10
    }))
    expect(current.transitions).toBe(24)
    expect(old.transitions).toBe(24)
  } finally {
    if (accountCreated) await deleteDisposableAccount(page)
  }
})
