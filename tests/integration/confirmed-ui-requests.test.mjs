import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { scanVisibleFeedPage } from '../../lib/app/visible-feed-page.js'

// Exercise the owning server functions with deterministic transport doubles,
// without auth credentials, production writes, or external catalogue reads.
async function load(path, dependencies, exports) {
  const code = (await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\r?\n/gm, '')
    .replace(/\bexport\s+(?=(?:async\s+)?function|const)/g, '')
  return new Function(...Object.keys(dependencies), `${code}\nreturn { ${exports} }`)(...Object.values(dependencies))
}

const location = { id: '00000000-0000-4000-8000-000000000002', slug: 'park', name: 'Park' }
const user = { id: '00000000-0000-4000-8000-000000000001' }
function savedClient(failTable, failAfterWrite = false) {
  let written = false
  const client = {
    auth: { getUser: async () => ({ data: { user } }) },
    from(table) {
      let mutation = false
      const result = () => ({ data: table === 'social_posts' ? [] : table === 'user_content_states' ? { location_id: location.id } : null, error: !mutation && table === failTable && (!failAfterWrite || written) ? { message: 'database unavailable' } : null })
      const query = { then: resolve => Promise.resolve(result()).then(resolve), maybeSingle: async () => result(), delete: () => { mutation = true; written = true; return query } }
      for (const method of ['select', 'eq', 'order', 'limit']) query[method] = () => query
      return query
    }
  }
  return client
}
async function savedRoute(client) {
  return load('app/api/saved-location/[slug]/route.js', {
    NextResponse: { json: Response.json }, createClient: async () => client,
    getPublicLocation: async () => ({ location }), createAdminClient: () => ({}),
    ensureGlobalLocationReferences: async () => {}, verifyCsrf: () => true,
    enforceRateLimit: async () => ({ allowed: true }), readJsonLimited: request => request.json(),
    safeSecurityError: (_error, fallback) => fallback, revalidatePath: () => {}, uuid: value => value
  }, 'GET, POST')
}

test('Saved detail errors cannot masquerade as unsaved state or empty content', async () => {
  for (const table of ['user_content_states', 'location_visits', 'social_posts']) {
    const { GET } = await savedRoute(savedClient(table))
    const response = await GET(null, { params: Promise.resolve({ slug: 'park' }) })
    assert.equal(response.status, 500, table)
    assert.deepEqual(await response.json(), { error: 'Saved details could not be loaded.' })
  }
  const { GET } = await savedRoute(savedClient(null))
  const response = await GET(null, { params: Promise.resolve({ slug: 'park' }) })
  assert.equal((await response.json()).state.saved, true)
})

test('a completed Saved write remains successful when its refresh fails', async () => {
  const { POST } = await savedRoute(savedClient('user_content_states', true))
  const response = await POST(new Request('http://localhost/api/saved-location/park', { method: 'POST', body: JSON.stringify({ action: 'toggle_saved' }) }), { params: Promise.resolve({ slug: 'park' }) })
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.match(body.refreshError, /change was saved/)
  assert.equal(body.state, undefined)
})

test('signup JSON errors retain form ownership and never echo personal fields', async () => {
  const { POST } = await load('app/api/auth/signup/route.js', {
    NextResponse: { json: Response.json }, enforceRequestSize: () => {},
    registerAccount: async () => ({ error: 'Account could not be created.' })
  }, 'POST')
  const form = new FormData()
  form.set('display_name', 'Private name')
  form.set('email', 'private@example.test')
  form.set('password', 'not-a-real-password')
  const response = await POST(new Request('http://localhost/api/auth/signup', { method: 'POST', headers: { accept: 'application/json' }, body: form }))
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'Account could not be created.' })
  assert.equal(response.headers.get('location'), null)
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('standalone signup returns only validation errors and still redirects on success', async () => {
  const form = new FormData()
  form.set('email', 'private@example.test')
  form.set('password', 'private-password')
  const redirect = destination => { throw Object.assign(new Error('redirect'), { destination }) }
  const { signUp } = await load('app/auth/actions.js', {
    registerAccount: async received => {
      assert.equal(received, form)
      return { error: 'Please retry.' }
    }, redirect
  }, 'signUp')
  assert.deepEqual(await signUp(null, form), { error: 'Please retry.' })
  const success = await load('app/auth/actions.js', {
    registerAccount: async () => ({ destination: '/onboarding' }), redirect
  }, 'signUp')
  await assert.rejects(success.signUp(null, form), error => error.destination === '/onboarding')
})

test('single-use challenge submissions do not retry a 403 and refresh CSRF on the next attempt', async () => {
  const writes = []
  let reads = 0
  const { csrfFetch } = await load('lib/security/csrf-client.js', {
    fetch: async (url, init) => {
      if (url === '/api/security/csrf') return Response.json({ token: `csrf-${++reads}` })
      writes.push(init)
      return Response.json({ error: 'Safety check required.' }, { status: 403 })
    }
  }, 'csrfFetch')
  for (const token of ['challenge-one', 'challenge-two']) {
    const response = await csrfFetch('/api/appeals', { method: 'POST', retryCsrf: false, body: token })
    assert.equal(response.status, 403)
  }
  assert.equal(writes.length, 2)
  assert.equal(reads, 2)
  assert.deepEqual(writes.map(init => init.headers.get('x-puddle-csrf')), ['csrf-1', 'csrf-2'])
  assert.equal(writes[0].retryCsrf, undefined)
})

test('an older Feed link starts at the visible target, not every intervening page', async () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(100 - index).padStart(12, '0')}`, created_at: new Date(Date.UTC(2026, 9, 12 - index)).toISOString(), location_id: location.id }))
  const focus = rows[8]
  focus.created_at = focus.created_at.replace('.000Z', '.083081+00:00')
  const requests = []
  const client = {
    rpc: async () => ({ data: [], error: null }),
    from(table) {
      let id, limit = rows.length, cursor
      const query = {
        select: () => query, order: () => query, in: () => query,
        eq: (key, value) => { if (key === 'id') id = value; return query },
        limit: value => { limit = value; return query },
        or: value => { cursor = value; return query },
        maybeSingle: async () => { requests.push({ id }); return { data: rows.find(row => row.id === id) || null, error: null } },
        then: resolve => {
          requests.push({ cursor, limit })
          const boundary = cursor?.match(/^created_at\.lt\.([^,]+),and\(.+id\.(lte|lt)\.([^)]+)\)$/)
          const micros = value => Date.parse(value) * 1000 + Number((value.match(/\.(\d+)/)?.[1] || '').padEnd(6, '0').slice(3, 6))
          const visible = table !== 'social_posts' ? [] : boundary ? rows.filter(row => {
            const time = micros(row.created_at), before = micros(boundary[1])
            return time < before || (time === before && (boundary[2] === 'lte' ? row.id <= boundary[3] : row.id < boundary[3]))
          }) : rows
          return Promise.resolve({ data: visible.slice(0, limit), error: null }).then(resolve)
        }
      }
      return query
    }
  }
  const { getSocialFeedSnapshot } = await load('lib/app/social-feed-data.js', {
    scanVisibleFeedPage, getLocationPreviews: async () => [location],
    SERVER_LATENCY_BUDGET_MS: {}, latencyStart: () => 0, elapsedMs: () => 0,
    createTraceId: () => 'fixture', recordServerLatency: () => {}, recordSloObservation: () => {}
  }, 'getSocialFeedSnapshot')
  const feed = await getSocialFeedSnapshot({ user, supabase: client }, '', { focusPostId: focus.id })
  assert.equal(feed.items[0].id, focus.id)
  assert.equal(feed.focusUnavailable, false)
  assert.equal(feed.items.length, 3)
  assert.equal(feed.pagination.hasMore, true)
  assert.equal(requests.filter(request => request.cursor).length, 1)
  assert.match(requests.find(request => request.cursor).cursor, new RegExp(`id.lte.${focus.id}`))
  const hidden = await getSocialFeedSnapshot({ user, supabase: client }, '', { focusPostId: '00000000-0000-4000-8000-000000000999' })
  assert.equal(hidden.focusUnavailable, true)
})

test('Feed cursors preserve database precision and reject unsafe timestamp syntax', async () => {
  const { validCursorTimestamp } = await load('lib/app/social-feed-data.js', {}, 'validCursorTimestamp')
  for (const value of ['2026-09-09T19:53:03.083081+00:00', '2026-09-09T19:53:03.083Z', '2026-09-09T19:53:03Z']) {
    assert.equal(validCursorTimestamp(value), value)
  }
  for (const value of ['', 'not a date', '2026-09-09T19:53:03Z),id.gt.1', '2026-09-09T99:53:03Z']) {
    assert.equal(validCursorTimestamp(value), null)
  }
})
