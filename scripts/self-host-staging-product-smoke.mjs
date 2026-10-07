import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { validateStagingAuthSmokeEnv } from './self-host-staging-auth-smoke.mjs'

export async function runStagingProductSmoke(env = process.env) {
  const { app, auth, site } = validateStagingAuthSmokeEnv(env)
  const admin = createClient(auth, env.PUDDLE_STAGING_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
  const id = randomUUID()
  const email = `puddle-product-smoke-${id}@example.invalid`
  const password = randomBytes(36).toString('base64url')
  let createdId
  let failure
  try {
    const created = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { display_name: 'Staging product smoke' }
    })
    if (created.error || !created.data?.user?.id) throw new Error(`Could not create disposable staging account: ${created.error?.message || 'no user'}`)
    createdId = created.data.user.id

    const login = await fetch(`${app}/api/auth/password`, {
      method: 'POST', body: new URLSearchParams({ email, password, next: '/discover' }),
      redirect: 'manual', signal: AbortSignal.timeout(15_000)
    })
    assert.equal(login.status, 303)
    assert.equal(new URL(login.headers.get('location')).origin, site)
    const cookie = login.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; ')
    assert.ok(cookie, 'A product smoke account needs a browser session')

    const home = { latitude: 43.65, longitude: -79.38 }
    const profile = await admin.from('profiles').update({
      username: `staging_${id.replaceAll('-', '').slice(0, 12)}`,
      birth_date: '2000-01-01', city: 'Toronto', ...home,
      interests: ['Food', 'Art', 'Outdoors'], onboarding_completed_at: new Date().toISOString()
    }).eq('id', createdId).select('id').single()
    if (profile.error || profile.data?.id !== createdId) throw new Error(`Could not prepare disposable profile: ${profile.error?.message || 'no row'}`)

    for (const path of ['/api/social-feed', '/api/map/snapshot']) {
      const response = await fetch(`${app}${path}`, {
        headers: { cookie }, signal: AbortSignal.timeout(30_000)
      })
      assert.equal(response.status, 200, `${path} must respond for an onboarded staging account`)
      const body = await response.json()
      const list = path === '/api/social-feed' ? body.items : body.points
      assert.ok(Array.isArray(list), `${path} must return its expected list shape`)
      process.stdout.write(`${path}: HTTP 200, ${list.length} items.\n`)
    }

    const viewport = new URL(`${app}/api/map/viewport`)
    for (const [name, value] of Object.entries({
      north: home.latitude + 0.1, south: home.latitude - 0.1,
      east: home.longitude + 0.1, west: home.longitude - 0.1, zoom: 11
    })) viewport.searchParams.set(name, String(value))
    const mapResponse = await fetch(viewport, {
      headers: { cookie }, signal: AbortSignal.timeout(30_000)
    })
    assert.equal(mapResponse.status, 200, 'A signed-in user must be able to load the Toronto map')
    const map = await mapResponse.json()
    assert.ok(Array.isArray(map.points) && map.points.length > 0, 'The copied catalogue must produce real Toronto map pins')
    process.stdout.write(`/api/map/viewport: ${map.points.length} real Toronto pins.\n`)

    for (const path of ['/plans', '/matches', '/profile', '/account']) {
      const response = await fetch(`${app}${path}`, {
        headers: { cookie }, redirect: 'manual', signal: AbortSignal.timeout(30_000)
      })
      assert.equal(response.status, 200, `${path} must render for an onboarded staging account`)
      const html = await response.text()
      assert.ok(html.includes('<main'), `${path} must include its main page content`)
      process.stdout.write(`${path}: HTTP 200 and page content.\n`)
    }
  } catch (error) {
    failure = error
  } finally {
    if (createdId) {
      const { error } = await admin.auth.admin.deleteUser(createdId)
      if (error) {
        const cleanup = new Error(`Disposable staging account cleanup failed: ${error.message}`)
        failure = failure ? new AggregateError([failure, cleanup], 'Staging product smoke and cleanup failed') : cleanup
      }
    }
  }
  if (failure) throw failure
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStagingProductSmoke().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
