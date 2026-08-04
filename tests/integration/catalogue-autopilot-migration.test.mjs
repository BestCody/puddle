import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationPath = new URL('../../supabase/migrations/10040_compact_legacy_import_revisions.sql', import.meta.url)
const workflowPath = new URL('../../.github/workflows/catalogue-canary-autopilot.yml', import.meta.url)

test('legacy imported revision compaction preserves authored and claimed content', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  assert.match(sql, /location\.source = 'import'/)
  assert.match(sql, /location\.created_by is null/)
  assert.match(sql, /location\.host_profile_id is null/)
  assert.match(sql, /location\.claimed_by_host_id is null/)
  assert.match(sql, /truncate table public\.location_revisions restart identity/)
  assert.match(sql, /overriding system value/)
  assert.match(sql, /create or replace function public\.capture_location_revision\(\)/)
})

test('catalogue autopilot dispatches only the inactive Toronto canary', async () => {
  const workflow = await readFile(workflowPath, 'utf8')
  assert.match(workflow, /us-canada-catalogue-canary\.yml\/dispatches/)
  assert.match(workflow, /market_id:\"toronto\"/)
  assert.match(workflow, /us-ca-canary-auto-/)
  assert.doesNotMatch(workflow, /us-canada-catalogue-launch\.yml\/dispatches/)
})
