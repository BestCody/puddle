import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const source = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Global likes has no route, runtime loader, actions, or navigation', async () => {
  for (const path of [
    'app/(product)/global-matches/page.js',
    'app/(product)/global-matches/actions.js',
    'lib/app/global-connections-data.js',
    'app/membership.css'
  ]) {
    await assert.rejects(access(new URL(`../../${path}`, import.meta.url)), { code: 'ENOENT' })
  }
  for (const path of ['proxy.js', 'components/product-nav.js', 'app/(product)/membership/actions.js', 'app/(product)/membership/checkout/page.js', 'app/privacy/page.js', 'app/terms/page.js']) {
    assert.doesNotMatch(await source(path), /global-matches|global_connection|saveGlobalPreference|global visibility|global connections|same-place/i)
  }
  assert.match(await source('app/(product)/membership/actions.js'), /snapshot\.active\) redirect\('\/membership\?view=manage'\)/)
})

test('the retirement migration removes only the separate Global likes schema without cascading', async () => {
  const migration = await source('supabase/migrations/20261011100000_remove_global_likes.sql')
  const tables = [...migration.matchAll(/drop table if exists public\.([a-z_]+);/g)].map((match) => match[1])
  assert.deepEqual(new Set(tables), new Set([
    'global_connection_reports', 'global_connection_messages', 'global_connection_threads',
    'global_connection_blocks', 'global_connection_preferences', 'global_connection_rate_limits'
  ]))
  const functions = [...migration.matchAll(/drop function if exists public\.([^;]+);/g)].map((match) => match[1])
  assert.deepEqual(new Set(functions), new Set([
    'global_like_matches_v1(integer)', 'request_global_connection_v1(uuid,uuid,text,text)',
    'respond_global_connection_v1(uuid,text)', 'send_global_connection_message_v1(uuid,text)',
    'global_connection_snapshot_v1()', 'block_global_connection_v1(uuid)',
    'report_global_connection_v1(uuid,uuid,text,text)', 'enforce_global_connection_report_limit_v1()',
    'enforce_global_connection_message_limit_v1()', 'enforce_global_connection_thread_limit_v1()',
    'consume_global_connection_rate_limit_v1(text)'
  ]))
  assert.doesNotMatch(migration, /\bcascade\b/i)
  assert.match(migration, /^begin;/)
  assert.match(migration, /commit;\s*$/)
  assert.ok(migration.indexOf('drop table if exists public.global_connection_messages') < migration.indexOf('drop table if exists public.global_connection_threads'))
})
