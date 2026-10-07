import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { requiredQuery } from '../../lib/app/required-query.js'
import { getAdminDashboard, getModerationCases } from '../../lib/app/admin-data.js'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('required database reads preserve empty results but propagate failures', async () => {
  const databaseError = new Error('database unavailable')
  assert.deepEqual(await requiredQuery(Promise.resolve({ data: [], error: null })), [])
  assert.equal(await requiredQuery(Promise.resolve({ data: null, error: null })), null)
  await assert.rejects(requiredQuery(Promise.resolve({ data: null, error: databaseError })), databaseError)
  await assert.rejects(requiredQuery(Promise.reject(databaseError)), databaseError)
})

test('admin reads surface database failures instead of presenting an empty safety queue', async () => {
  const databaseError = new Error('moderation database unavailable')
  const supabase = {
    rpc: () => Promise.resolve({ data: null, error: databaseError }),
    from: () => ({
      select() { return this },
      order() { return this },
      limit() { return Promise.resolve({ data: null, error: databaseError }) }
    })
  }
  await assert.rejects(getAdminDashboard(supabase), databaseError)
  await assert.rejects(getModerationCases(supabase), databaseError)
})

test('sensitive pages distinguish failed reads from empty data', async () => {
  const [recommendations, appeals, content, security] = await Promise.all([
    read('app/settings/recommendations/page.js'),
    read('app/appeals/page.js'),
    read('app/admin/content/page.js'),
    read('app/admin/security/page.js')
  ])
  for (const source of [recommendations, appeals, content, security]) {
    assert.match(source, /requiredQuery\(/)
    assert.match(source, /role="alert"/)
    assert.match(source, /Try again/)
  }
  assert.match(recommendations, /preferences \? <RecommendationSettings/)
  assert.match(appeals, /return <section className="admin-card" role="alert"/)
  assert.match(content, /subjectType=\{item\.subject_type\}/)
  assert.doesNotMatch(content, /filter\(\(item\) => item\.subject_type === 'location'\)/)
})

test('audience-specific notices and recommendation settings are never shared-cached', async () => {
  const [notices, recommendations] = await Promise.all([
    read('app/api/system/notices/route.js'),
    read('app/api/recommendations/preferences/route.js')
  ])
  assert.match(notices, /'Cache-Control': 'private, no-store'/)
  assert.match(notices, /if \(error\) throw error/)
  assert.match(notices, /status: 503/)
  assert.doesNotMatch(notices, /public, max-age/)
  assert.match(recommendations, /preferencesError \|\| flagsError/)
  assert.match(recommendations, /status: 503, headers: privateHeaders/)
})
