import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

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
