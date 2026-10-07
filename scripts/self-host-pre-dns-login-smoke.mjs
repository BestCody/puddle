import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

if (process.env.PUDDLE_PRE_DNS_CONFIRM !== 'private-only') {
  throw new Error('Explicit private-only confirmation is required')
}

function loopbackOrigin(value, label) {
  const url = new URL(value)
  assert.equal(url.protocol, 'http:', `${label} must use HTTP loopback`)
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), `${label} must use loopback`)
  assert.equal(url.pathname, '/', `${label} must be an origin`)
  return url.origin
}

const app = loopbackOrigin(process.env.PUDDLE_PRE_DNS_APP_URL, 'App URL')
const auth = loopbackOrigin(process.env.PUDDLE_PRE_DNS_AUTH_URL, 'Auth URL')
const site = new URL(process.env.PUDDLE_PRE_DNS_SITE_URL)
assert.equal(site.protocol, 'https:')
assert.equal(site.pathname, '/')
assert.ok(process.env.SUPABASE_SECRET_KEY, 'A private self-hosted service key is required')

const admin = createClient(auth, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
})

function appRequest(path, { method = 'GET', body, cookie, contentType, origin, csrfToken } = {}) {
  return new Promise((resolve, reject) => {
    const content = body ? Buffer.from(body) : null
    const headers = { host: site.host }
    if (content) {
      headers['content-type'] = contentType || 'application/x-www-form-urlencoded'
      headers['content-length'] = String(content.length)
    }
    if (cookie) headers.cookie = cookie
    if (origin) headers.origin = origin
    if (csrfToken) headers['x-puddle-csrf'] = csrfToken
    const request = httpRequest(new URL(path, app), { method, headers, timeout: 15_000 }, (response) => {
      const chunks = []
      let size = 0
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > 2_000_000) request.destroy(new Error('Response exceeded the smoke-test limit'))
        else chunks.push(chunk)
      })
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }))
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new Error('Private app request timed out')))
    request.on('error', reject)
    request.end(content)
  })
}

const routeProbe = await appRequest('/api/auth/password', {
  method: 'POST', body: new URLSearchParams({ email: 'invalid@example.invalid', password: 'invalid' }).toString()
})
assert.equal(routeProbe.status, 303, 'Password route must be reachable through Caddy')
const email = `puddle-pre-dns-smoke-${randomUUID()}@example.invalid`
const password = randomBytes(36).toString('base64url')
let userId
let failure

try {
  const created = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: 'Private pre-DNS smoke' }
  })
  if (created.error) throw created.error
  userId = created.data?.user?.id
  assert.ok(userId, 'Disposable account creation must return a user')

  const login = await appRequest('/api/auth/password', {
    method: 'POST', body: new URLSearchParams({ email, password, next: '/discover' }).toString()
  })
  if (login.status !== 303) {
    throw new Error(`Password login returned ${login.status} through the private proxy`)
  }
  const destination = new URL(login.headers.location)
  assert.equal(destination.origin, site.origin, 'Redirect must use the final site origin')
  assert.equal(destination.pathname, '/onboarding', 'New users must enter onboarding')
  const cookies = (login.headers['set-cookie'] || []).map((value) => value.split(';', 1)[0]).join('; ')
  assert.ok(cookies, 'Password login must set a session cookie')

  const session = await appRequest('/api/auth/session', { cookie: cookies })
  assert.equal(session.status, 200)
  const state = JSON.parse(session.body)
  assert.equal(state.authenticated, true)
  assert.equal(state.user.id, userId)

  const onboarding = await appRequest('/onboarding', { cookie: cookies })
  assert.equal(onboarding.status, 200, 'Authenticated onboarding must render')
  process.stdout.write('Private production-origin login, cookie, and onboarding passed.\n')

  const csrf = await appRequest('/api/security/csrf', { cookie: cookies })
  assert.equal(csrf.status, 200)
  const { token } = JSON.parse(csrf.body)
  assert.ok(token)
  const csrfCookies = (csrf.headers['set-cookie'] || []).map((value) => value.split(';', 1)[0]).join('; ')
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#efc850' } }).png().toBuffer()
  const boundary = `puddle-${randomUUID()}`
  const uploadBody = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nprofile_photo\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="pre-dns-smoke.png"\r\nContent-Type: image/png\r\n\r\n`),
    image,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ])
  const upload = await appRequest('/api/media/upload', {
    method: 'POST', body: uploadBody, contentType: `multipart/form-data; boundary=${boundary}`,
    cookie: `${cookies}; ${csrfCookies}`, origin: site.origin, csrfToken: token
  })
  const result = JSON.parse(upload.body)
  assert.equal(upload.status, 201, `Private app upload failed: ${result.error || upload.status}`)
  const asset = await admin.from('media_assets').select('id,bucket_id,object_path,sha256')
    .eq('id', result.asset.id).eq('owner_id', userId).single()
  assert.equal(asset.error, null)
  const stored = await admin.storage.from(asset.data.bucket_id).download(asset.data.object_path)
  assert.equal(stored.error, null)
  assert.equal(createHash('sha256').update(Buffer.from(await stored.data.arrayBuffer())).digest('hex'), asset.data.sha256)
  process.stdout.write('Private profile upload and stored-byte hash passed.\n')
} catch (error) {
  failure = error
} finally {
  if (userId) {
    const assets = await admin.from('media_assets').select('id,bucket_id,object_path').eq('owner_id', userId)
    if (assets.error) {
      failure = failure ? new AggregateError([failure, assets.error]) : assets.error
    } else {
      for (const asset of assets.data || []) {
        const detached = await admin.from('profiles').update({ avatar_path: null }).eq('id', userId)
        const removed = await admin.storage.from(asset.bucket_id).remove([asset.object_path])
        const deleted = await admin.from('media_assets').delete().eq('id', asset.id).eq('owner_id', userId)
        for (const operation of [detached, removed, deleted]) {
          if (operation.error) failure = failure ? new AggregateError([failure, operation.error]) : operation.error
        }
      }
    }
    const deleted = await admin.auth.admin.deleteUser(userId)
    if (deleted.error) {
      const cleanup = new Error(`Disposable account cleanup failed: ${deleted.error.message}`)
      failure = failure ? new AggregateError([failure, cleanup]) : cleanup
    }
  }
}

if (failure) throw failure
