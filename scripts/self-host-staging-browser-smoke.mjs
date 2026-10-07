import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { chromium, devices } from 'playwright'
import { validateStagingAuthSmokeEnv } from './self-host-staging-auth-smoke.mjs'

function browserCookies(response, app) {
  return response.headers.getSetCookie().map((header) => {
    const first = header.split(';', 1)[0]
    const separator = first.indexOf('=')
    return { name: first.slice(0, separator), value: first.slice(separator + 1), url: app }
  })
}

export async function runStagingBrowserSmoke(env = process.env) {
  const { app, auth, site } = validateStagingAuthSmokeEnv(env)
  const publicApi = new URL(env.PUDDLE_STAGING_PUBLIC_API_URL)
  if (publicApi.protocol !== 'https:' || !publicApi.hostname.includes('staging.') && !publicApi.hostname.includes('-staging.') ||
      publicApi.pathname !== '/' || publicApi.search || publicApi.hash) {
    throw new Error('PUDDLE_STAGING_PUBLIC_API_URL must be a dedicated HTTPS staging origin')
  }
  const admin = createClient(auth, env.PUDDLE_STAGING_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
  const id = randomUUID()
  const email = `puddle-browser-smoke-${id}@example.invalid`
  const password = randomBytes(36).toString('base64url')
  let createdId
  let browser
  let failure
  try {
    const created = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { display_name: 'Staging browser smoke' }
    })
    if (created.error || !created.data?.user?.id) throw new Error(`Could not create disposable account: ${created.error?.message || 'no user'}`)
    createdId = created.data.user.id
    const login = await fetch(`${app}/api/auth/password`, {
      method: 'POST', body: new URLSearchParams({ email, password, next: '/plans' }),
      redirect: 'manual', signal: AbortSignal.timeout(15_000)
    })
    assert.equal(login.status, 303)
    assert.equal(new URL(login.headers.get('location')).origin, site)
    const cookies = browserCookies(login, app)
    assert.ok(cookies.length)
    const profile = await admin.from('profiles').update({
      username: `staging_${id.replaceAll('-', '').slice(0, 12)}`,
      birth_date: '2000-01-01', city: 'Toronto', latitude: 43.65, longitude: -79.38,
      interests: ['Food', 'Art', 'Outdoors'], onboarding_completed_at: new Date().toISOString()
    }).eq('id', createdId).select('id').single()
    if (profile.error || profile.data?.id !== createdId) throw new Error(`Could not prepare disposable profile: ${profile.error?.message || 'no row'}`)

    browser = await chromium.launch({ headless: true })
    for (const [name, device] of [['desktop', devices['Desktop Chrome']], ['mobile', devices['Pixel 5']]]) {
      const context = await browser.newContext({ ...device })
      try {
        await context.addCookies(cookies)
        // DNS/TLS is intentionally deferred. Only browser requests to the exact
        // staging API origin are replayed through the private SSH tunnel.
        await context.route(`${publicApi.origin}/**`, async (route) => {
          const requestUrl = new URL(route.request().url())
          const response = await route.fetch({
            url: `${auth}${requestUrl.pathname}${requestUrl.search}`,
            timeout: 15_000
          })
          await route.fulfill({
            response,
            headers: {
              ...response.headers(),
              'access-control-allow-origin': app,
              'access-control-allow-credentials': 'true'
            }
          })
        })
        const page = await context.newPage()
        for (const path of ['/plans', '/matches', '/profile', '/account']) {
          const response = await page.goto(`${app}${path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          assert.equal(response.status(), 200, `${name} ${path} must render`)
          await page.locator('.figma-dashboard-shell').waitFor({ timeout: 10_000 })
          await page.waitForFunction(
            () => (document.querySelector('.figma-dashboard-main')?.innerText.trim().length || 0) > 30,
            null,
            { timeout: 15_000 }
          )
          await page.locator('.puddle-route-stream-placeholder').waitFor({ state: 'hidden', timeout: 15_000 })
          await page.evaluate(() => document.fonts.ready)
          const geometry = await page.evaluate(() => ({
            width: window.innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            contentLength: document.querySelector('.figma-dashboard-main')?.innerText.trim().length || 0,
            nav: (() => {
              const element = document.querySelector('.figma-dashboard-mobile-nav')
              if (!element) return null
              const rect = element.getBoundingClientRect()
              return { top: rect.top, bottom: rect.bottom, display: getComputedStyle(element).display }
            })()
          }))
          assert.ok(geometry.documentWidth <= geometry.width + 2, `${name} ${path} has horizontal page overflow`)
          assert.ok(geometry.contentLength > 30, `${name} ${path} must render real page content`)
          if (name === 'mobile') {
            assert.notEqual(geometry.nav?.display, 'none', `${path} must retain bottom navigation on mobile`)
            assert.ok(geometry.nav.top >= 0 && geometry.nav.bottom <= device.viewport.height + 2,
              `${path} bottom navigation must fit inside the viewport`)
          }
          process.stdout.write(`${name} ${path}: rendered, no horizontal overflow${name === 'mobile' ? ', bottom nav visible' : ''}.\n`)
          if (name === 'mobile' && path === '/plans') {
            await page.getByRole('navigation', { name: 'Puddle mobile navigation' })
              .getByRole('link', { name: 'Friends' }).click()
            await page.waitForURL(`${app}/matches`, { timeout: 15_000 })
            assert.ok(await page.locator('.figma-dashboard-mobile-nav').isVisible(),
              'Bottom navigation must remain visible after a mobile route transition')
            process.stdout.write('mobile Saved → Friends navigation passed.\n')
          }
        }
      } finally {
        await context.close()
      }
    }
  } catch (error) {
    failure = error
  } finally {
    if (browser) await browser.close()
    if (createdId) {
      const { error } = await admin.auth.admin.deleteUser(createdId)
      if (error) {
        const cleanup = new Error(`Disposable staging account cleanup failed: ${error.message}`)
        failure = failure ? new AggregateError([failure, cleanup], 'Staging browser smoke and cleanup failed') : cleanup
      }
    }
  }
  if (failure) throw failure
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStagingBrowserSmoke().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
