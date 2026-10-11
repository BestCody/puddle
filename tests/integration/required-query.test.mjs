import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { requiredQuery } from '../../lib/app/required-query.js'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('required database reads preserve empty results but propagate failures', async () => {
  const databaseError = new Error('database unavailable')
  assert.deepEqual(await requiredQuery(Promise.resolve({ data: [], error: null })), [])
  assert.equal(await requiredQuery(Promise.resolve({ data: null, error: null })), null)
  await assert.rejects(requiredQuery(Promise.resolve({ data: null, error: databaseError })), databaseError)
  await assert.rejects(requiredQuery(Promise.reject(databaseError)), databaseError)
})

test('dashboard bootstrap no longer performs a staff-role lookup', async () => {
  const [runtime, migration] = await Promise.all([
    read('components/dashboard-runtime.js'),
    read('supabase/migrations/20261011090000_remove_admin_dashboard_bootstrap.sql')
  ])
  assert.doesNotMatch(runtime, /showAdmin|href="\/admin"/)
  assert.doesNotMatch(migration, /'show_admin'|v_access\s*:=/)
  assert.match(migration, /'unread_notifications'/)
  assert.match(migration, /'pass_active'/)
  assert.match(migration, /revoke execute on function/)
})

test('sensitive pages distinguish failed reads from empty data', async () => {
  const [recommendations, appeals] = await Promise.all([
    read('app/settings/recommendations/page.js'),
    read('app/appeals/page.js')
  ])
  for (const source of [recommendations, appeals]) {
    assert.match(source, /requiredQuery\(/)
    assert.match(source, /role="alert"/)
    assert.match(source, /Try again/)
  }
  assert.match(recommendations, /preferences \? <RecommendationSettings/)
  assert.match(appeals, /return <section className=\{styles\.card\} role="alert"/)
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
