import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import { stagingEmailLink, validateStagingAuthSmokeEnv } from './self-host-staging-auth-smoke.mjs'
import { installStagingSiteProxy } from './self-host-staging-site-proxy.mjs'

export async function runStagingPasswordSmoke(env = process.env) {
  const { app, auth, site, mailpit } = validateStagingAuthSmokeEnv(env)
  if (!mailpit) throw new Error('The private staging mail sink is required for password recovery')
  const admin = createClient(auth, env.PUDDLE_STAGING_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
  const email = `puddle-password-smoke-${randomUUID()}@example.invalid`
  const oldPassword = randomBytes(36).toString('base64url')
  const newPassword = randomBytes(36).toString('base64url')
  let createdId
  let browser
  let failure
  try {
    const created = await admin.auth.admin.createUser({ email, password: oldPassword, email_confirm: true })
    if (created.error || !created.data?.user?.id) throw new Error(`Could not create disposable account: ${created.error?.message || 'no user'}`)
    createdId = created.data.user.id
    const { error } = await admin.auth.resetPasswordForEmail(email, {
      redirectTo: `${site}/auth/callback?next=/update-password`
    })
    assert.equal(error, null, 'Staging Auth must send a recovery email')
    const link = await stagingEmailLink(mailpit, email)
    assert.equal(link.origin, site)
    assert.equal(link.pathname, '/auth/confirm')
    assert.equal(link.searchParams.get('type'), 'recovery')
    const confirmation = await fetch(`${app}${link.pathname}${link.search}`, {
      redirect: 'manual', signal: AbortSignal.timeout(15_000)
    })
    assert.ok(confirmation.status >= 300 && confirmation.status < 400)
    assert.equal(new URL(confirmation.headers.get('location')).pathname, '/update-password')
    const cookies = confirmation.headers.getSetCookie().map((header) => {
      const first = header.split(';', 1)[0]
      const separator = first.indexOf('=')
      return { name: first.slice(0, separator), value: first.slice(separator + 1), url: site }
    })
    assert.ok(cookies.length)

    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    await context.addCookies(cookies)
    // Exercise the public HTTPS origin without changing DNS. Next.js server
    // actions and the app's CSRF guard both require its real browser origin.
    await installStagingSiteProxy(context, { site, app })
    const page = await context.newPage()
    const formResponses = []
    const pageErrors = []
    page.on('response', (response) => {
      if (response.request().method() === 'POST' && new URL(response.url()).pathname === '/update-password') {
        formResponses.push({ status: response.status(), response })
      }
    })
    page.on('pageerror', (error) => pageErrors.push(error.name))
    const resetPage = await page.goto(`${site}/update-password`, { waitUntil: 'load' })
    assert.equal(resetPage.status(), 200)
    await page.getByLabel('New password').fill(newPassword)
    await page.getByLabel('Confirm password').fill(newPassword)
    await page.getByRole('button', { name: /Update password/ }).click()
    try {
      await page.waitForURL(/\/account(?:\?|$)/, { timeout: 15_000, waitUntil: 'commit' })
    } catch {
      const current = new URL(page.url())
      const message = await page.locator('.auth-message').first().textContent().catch(() => '')
      const button = await page.getByRole('button', { name: /Update password/ }).first().isDisabled().catch(() => false)
      const formStatus = await Promise.all(formResponses.map(async ({ status, response }) => {
        const body = status >= 400 ? (await response.text().catch(() => '')).slice(0, 160) : ''
        return `${status}${body ? ` (${body.replace(/\s+/g, ' ')})` : ''}`
      }))
      throw new Error(`Password form did not reach account: ${current.origin}${current.pathname}; ${message || 'no form message'}; form statuses ${formStatus.join(',') || 'none'}; button disabled ${button}; page errors ${pageErrors.join(',') || 'none'}`)
    }
    await context.close()

    const client = createClient(auth, env.PUDDLE_STAGING_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })
    const oldLogin = await client.auth.signInWithPassword({ email, password: oldPassword })
    assert.ok(oldLogin.error, 'The prior password must be rejected after reset')
    const newLogin = await client.auth.signInWithPassword({ email, password: newPassword })
    assert.equal(newLogin.error, null, 'The new password must authenticate')
    assert.equal(newLogin.data.user?.id, createdId)
    process.stdout.write('Staging recovery email, password form, old-password rejection, and new login passed.\n')
  } catch (error) {
    failure = error
  } finally {
    if (browser) await browser.close()
    if (createdId) {
      const { error } = await admin.auth.admin.deleteUser(createdId)
      if (error) {
        const cleanup = new Error(`Disposable staging account cleanup failed: ${error.message}`)
        failure = failure ? new AggregateError([failure, cleanup], 'Staging password smoke and cleanup failed') : cleanup
      }
    }
  }
  if (failure) throw failure
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStagingPasswordSmoke().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
