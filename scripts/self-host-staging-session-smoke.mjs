import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import { validateStagingAuthSmokeEnv } from './self-host-staging-auth-smoke.mjs'
import { installStagingSiteProxy } from './self-host-staging-site-proxy.mjs'

export async function runStagingSessionSmoke(env = process.env) {
  const { app, auth, site } = validateStagingAuthSmokeEnv(env)
  const admin = createClient(auth, env.PUDDLE_STAGING_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
  const email = `puddle-session-smoke-${randomUUID()}@example.invalid`
  const password = randomBytes(36).toString('base64url')
  let userId
  let browser
  let failure
  try {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    assert.equal(created.error, null)
    userId = created.data.user.id
    const profile = await admin.from('profiles').upsert({
      id: userId, display_name: 'Staging session smoke',
      username: `staging_${userId.replaceAll('-', '').slice(0, 12)}`,
      birth_date: '2000-01-01', city: 'Toronto',
      onboarding_completed_at: new Date().toISOString()
    })
    assert.equal(profile.error, null)

    browser = await chromium.launch({ headless: true })
    const firstContext = await browser.newContext()
    await installStagingSiteProxy(firstContext, { site, app })
    const firstPage = await firstContext.newPage()
    const landing = await firstPage.goto(`${site}/landing.html`, { waitUntil: 'domcontentloaded' })
    assert.equal(landing.status(), 200)
    await firstPage.locator('#landing-email').fill(email)
    await firstPage.locator('#landing-password').fill(password)
    const loginResponse = firstPage.waitForResponse((response) => response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/auth/password', { timeout: 20_000 })
    await firstPage.locator('.landing-login-form .continue-button').click()
    const submitted = await loginResponse
    assert.equal(submitted.status(), 303)
    const destination = new URL(submitted.headers().location)
    assert.equal(destination.origin, site)
    assert.equal(destination.pathname, '/discover')
    const persisted = await firstContext.storageState()
    assert.ok(persisted.cookies.some(({ name }) => name.includes('auth-token')),
      'Browser login must store an Auth cookie')
    await firstContext.close()

    const reopenedContext = await browser.newContext({ storageState: persisted })
    await installStagingSiteProxy(reopenedContext, { site, app })
    const reopenedPage = await reopenedContext.newPage()
    const dashboard = await reopenedPage.goto(`${site}/profile`, { waitUntil: 'domcontentloaded' })
    assert.equal(dashboard.status(), 200)
    assert.equal(new URL(reopenedPage.url()).pathname, '/profile',
      'A reopened browser must retain the authenticated account')
    await reopenedPage.locator('.figma-dashboard-shell').waitFor({ timeout: 15_000 })
    await reopenedContext.close()
    process.stdout.write('Staging landing login and browser-reopen session persistence passed.\n')
  } catch (error) {
    failure = error
  } finally {
    if (browser) await browser.close()
    if (userId) {
      const deleted = await admin.auth.admin.deleteUser(userId)
      if (deleted.error) {
        const cleanup = new Error(`Disposable account cleanup failed: ${deleted.error.message}`)
        failure = failure ? new AggregateError([failure, cleanup], 'Session smoke and cleanup failed') : cleanup
      }
    }
  }
  if (failure) throw failure
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStagingSessionSmoke().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
