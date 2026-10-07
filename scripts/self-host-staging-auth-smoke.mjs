import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'

function loopbackOrigin(value, label) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${label} must be an HTTP loopback origin reached through the staging SSH tunnel`)
  }
  return url.origin
}

export function validateStagingAuthSmokeEnv(env) {
  if (env.PUDDLE_STAGING_CONFIRM !== 'staging-only') throw new Error('Explicit staging-only confirmation is required')
  const app = loopbackOrigin(env.PUDDLE_STAGING_APP_URL, 'PUDDLE_STAGING_APP_URL')
  const auth = loopbackOrigin(env.PUDDLE_STAGING_AUTH_URL, 'PUDDLE_STAGING_AUTH_URL')
  const site = new URL(env.PUDDLE_STAGING_SITE_URL)
  if (site.protocol !== 'https:' || !site.hostname.startsWith('staging.') || site.pathname !== '/' || site.search || site.hash) {
    throw new Error('PUDDLE_STAGING_SITE_URL must be a dedicated HTTPS staging origin')
  }
  if (!env.PUDDLE_STAGING_SERVICE_KEY) throw new Error('A self-hosted staging service key is required')
  const mailpit = env.PUDDLE_STAGING_MAILPIT_URL
    ? loopbackOrigin(env.PUDDLE_STAGING_MAILPIT_URL, 'PUDDLE_STAGING_MAILPIT_URL')
    : null
  return { app, auth, site: site.origin, mailpit }
}

export async function stagingEmailLink(mailpit, recipient) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const list = await fetch(`${mailpit}/api/v1/messages`, { signal: AbortSignal.timeout(5_000) })
    assert.equal(list.status, 200, 'The private staging mail sink must respond')
    const messages = (await list.json()).messages || []
    const message = messages.find((entry) => entry.To?.some((to) => to.Address === recipient))
    if (message) {
      const detail = await fetch(`${mailpit}/api/v1/message/${encodeURIComponent(message.ID)}`, {
        signal: AbortSignal.timeout(5_000)
      })
      assert.equal(detail.status, 200)
      const html = (await detail.json()).HTML || ''
      const href = /href="([^"]+)"/.exec(html)?.[1]
      assert.ok(href, 'The staging email must contain a link')
      return new URL(href.replaceAll('&amp;', '&'))
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('The staging email was not captured')
}

export async function runStagingAuthSmoke(env = process.env) {
  const { app, auth, site, mailpit } = validateStagingAuthSmokeEnv(env)
  const healthResponse = await fetch(`${app}/api/health`, { signal: AbortSignal.timeout(10_000) })
  assert.equal(healthResponse.status, 200, 'Staging app health must respond before creating a test account')
  const health = await healthResponse.json()
  assert.equal(health.authConfigured, true)
  assert.equal(health.supabaseTransportConfigured, true)
  assert.match(String(health.buildSha || ''), /^staging-/)

  const admin = createClient(auth, env.PUDDLE_STAGING_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
  const email = `puddle-smoke-${randomUUID()}@example.invalid`
  const password = randomBytes(36).toString('base64url')
  let createdId
  let failure
  try {
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { display_name: 'Staging smoke' }
    })
    if (error || !data?.user?.id) throw new Error(`Staging account creation failed: ${error?.message || 'no user returned'}`)
    createdId = data.user.id

    const login = await fetch(`${app}/api/auth/password`, {
      method: 'POST',
      body: new URLSearchParams({ email, password, next: '/discover' }),
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000)
    })
    assert.equal(login.status, 303, 'Password login must redirect after success')
    const destination = new URL(login.headers.get('location'))
    assert.equal(destination.origin, site, 'Login must redirect to the configured public site')
    assert.equal(destination.pathname, '/onboarding', 'A new account must enter onboarding')
    const cookieHeader = login.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; ')
    assert.ok(cookieHeader, 'Login must issue a persistent session cookie')

    const session = await fetch(`${app}/api/auth/session`, {
      headers: { cookie: cookieHeader }, signal: AbortSignal.timeout(10_000)
    })
    assert.equal(session.status, 200, 'The server must read the browser login cookie')
    const state = await session.json()
    assert.equal(state.authenticated, true)
    assert.equal(state.user.id, createdId)

    const onboarding = await fetch(`${app}/onboarding`, {
      headers: { cookie: cookieHeader }, redirect: 'manual', signal: AbortSignal.timeout(15_000)
    })
    assert.equal(onboarding.status, 200, 'The authenticated onboarding page must render')
    process.stdout.write('Staging password login, shared session cookie, and onboarding route passed.\n')

    if (mailpit) {
      const { error: resetError } = await admin.auth.resetPasswordForEmail(email, {
        redirectTo: `${site}/auth/callback?next=/update-password`
      })
      assert.equal(resetError, null, 'The staging Auth service must send a password-reset email')
      const link = await stagingEmailLink(mailpit, email)
      assert.equal(link.origin, site, 'The reset email must use the public staging site')
      assert.equal(link.pathname, '/auth/confirm')
      assert.equal(link.searchParams.get('type'), 'recovery')
      assert.ok(link.searchParams.has('token_hash'), 'The reset link must contain a verification token')
      const confirmation = await fetch(`${app}${link.pathname}${link.search}`, {
        redirect: 'manual', signal: AbortSignal.timeout(15_000)
      })
      assert.ok(confirmation.status >= 300 && confirmation.status < 400, 'The reset link must redirect')
      const resetDestination = new URL(confirmation.headers.get('location'))
      assert.equal(resetDestination.origin, site)
      assert.equal(resetDestination.pathname, '/update-password', 'Recovery must open the password page')
      const resetCookies = confirmation.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; ')
      assert.ok(resetCookies, 'Recovery must establish a session')
      const resetPage = await fetch(`${app}/update-password`, {
        headers: { cookie: resetCookies }, redirect: 'manual', signal: AbortSignal.timeout(15_000)
      })
      assert.equal(resetPage.status, 200, 'The password page must render with the recovery session')
      process.stdout.write('Staging password-reset email, confirmation, session, and password page passed.\n')
    }
  } catch (error) {
    failure = error
  } finally {
    if (createdId) {
      const { error } = await admin.auth.admin.deleteUser(createdId)
      if (error) {
        const cleanup = new Error(`Disposable staging account cleanup failed: ${error.message}`)
        failure = failure ? new AggregateError([failure, cleanup], 'Staging auth smoke and cleanup failed') : cleanup
      }
    }
  }
  if (failure) throw failure

  const signupEmail = `puddle-signup-smoke-${randomUUID()}@example.invalid`
  let signupFailure
  try {
    const signup = await fetch(`${app}/api/auth/signup`, {
      method: 'POST',
      body: new URLSearchParams({
        display_name: 'Staging signup', email: signupEmail,
        password: randomBytes(36).toString('base64url'), terms_accepted: 'yes'
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000)
    })
    assert.equal(signup.status, 303, 'Email signup must redirect after success')
    const destination = new URL(signup.headers.get('location'))
    assert.equal(destination.origin, site)
    assert.equal(destination.pathname, '/onboarding',
      `Signup must enter onboarding without an intermediate screen: ${destination.searchParams.get('error') || 'no public error'}`)
    const cookieHeader = signup.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; ')
    assert.ok(cookieHeader, 'Signup must issue a session cookie')
    const session = await fetch(`${app}/api/auth/session`, {
      headers: { cookie: cookieHeader }, signal: AbortSignal.timeout(10_000)
    })
    assert.equal(session.status, 200)
    const state = await session.json()
    assert.equal(state.authenticated, true)
    assert.equal(state.user.email, signupEmail)
    if (mailpit) {
      const link = await stagingEmailLink(mailpit, signupEmail)
      assert.equal(link.origin, site, 'Signup confirmation must use the public staging site')
      assert.equal(link.pathname, '/auth/confirm')
      assert.equal(link.searchParams.get('type'), 'signup')
      assert.ok(link.searchParams.has('token_hash'))
    }
    process.stdout.write('Staging email signup and immediate authenticated onboarding passed.\n')
  } catch (error) {
    signupFailure = error
  } finally {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    if (error) {
      const cleanup = new Error(`Could not locate disposable signup account for cleanup: ${error.message}`)
      signupFailure = signupFailure ? new AggregateError([signupFailure, cleanup], 'Signup and cleanup failed') : cleanup
    } else {
      const user = data.users.find((candidate) => candidate.email === signupEmail)
      if (user) {
        const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
        if (deleteError) {
          const cleanup = new Error(`Disposable signup account cleanup failed: ${deleteError.message}`)
          signupFailure = signupFailure ? new AggregateError([signupFailure, cleanup], 'Signup and cleanup failed') : cleanup
        }
      }
    }
  }
  if (signupFailure) throw signupFailure
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStagingAuthSmoke().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
