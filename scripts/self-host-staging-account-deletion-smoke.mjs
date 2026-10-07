import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import { validateStagingAuthSmokeEnv } from './self-host-staging-auth-smoke.mjs'
import { installStagingSiteProxy } from './self-host-staging-site-proxy.mjs'

export async function runStagingAccountDeletionSmoke(env = process.env) {
  const { app, auth, site } = validateStagingAuthSmokeEnv(env)
  const admin = createClient(auth, env.PUDDLE_STAGING_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
  const email = `puddle-deletion-smoke-${randomUUID()}@example.invalid`
  const password = randomBytes(36).toString('base64url')
  let userId
  let browser
  let failure
  try {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    assert.equal(created.error, null)
    userId = created.data.user.id
    const profile = await admin.from('profiles').upsert({
      id: userId, display_name: 'Staging deletion smoke',
      username: `staging_${userId.replaceAll('-', '').slice(0, 12)}`,
      birth_date: '2000-01-01', city: 'Toronto',
      onboarding_completed_at: new Date().toISOString()
    })
    assert.equal(profile.error, null)
    const login = await fetch(`${app}/api/auth/password`, {
      method: 'POST', body: new URLSearchParams({ email, password }),
      redirect: 'manual', signal: AbortSignal.timeout(15_000)
    })
    assert.equal(login.status, 303)
    const cookies = login.headers.getSetCookie().map((header) => {
      const first = header.split(';', 1)[0]
      const separator = first.indexOf('=')
      return { name: first.slice(0, separator), value: first.slice(separator + 1), url: site }
    })
    assert.ok(cookies.length)

    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    await context.addCookies(cookies)
    await installStagingSiteProxy(context, { site, app })
    const page = await context.newPage()
    const settings = await page.goto(`${site}/account?section=account`, { waitUntil: 'domcontentloaded' })
    assert.equal(settings.status(), 200)
    const confirmation = page.locator('input[name="confirmation"]')
    await confirmation.fill('DELETE')
    await page.getByRole('button', { name: 'Delete my account' }).click()
    await page.waitForURL((url) => url.origin === site && url.pathname === '/' &&
      url.searchParams.get('account') === 'deleted', { timeout: 20_000, waitUntil: 'commit' })
    await context.close()

    const lookup = await admin.auth.admin.getUserById(userId)
    assert.ok(lookup.error || !lookup.data?.user, 'The deleted Auth user must not remain')
    const remainingProfile = await admin.from('profiles').select('id').eq('id', userId).maybeSingle()
    assert.equal(remainingProfile.error, null)
    assert.equal(remainingProfile.data, null, 'The deleted profile must not remain')
    process.stdout.write('Staging Settings account deletion removed the Auth user and profile.\n')
  } catch (error) {
    failure = error
  } finally {
    if (browser) await browser.close()
    if (userId) {
      const lookup = await admin.auth.admin.getUserById(userId)
      if (lookup.data?.user) {
        const deleted = await admin.auth.admin.deleteUser(userId)
        if (deleted.error) {
          const cleanup = new Error(`Disposable account cleanup failed: ${deleted.error.message}`)
          failure = failure ? new AggregateError([failure, cleanup], 'Account deletion smoke and cleanup failed') : cleanup
        }
      }
    }
  }
  if (failure) throw failure
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStagingAccountDeletionSmoke().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
