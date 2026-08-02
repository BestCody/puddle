import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL('../../supabase/migrations/10021_catalogue_quality_backfill.sql', import.meta.url)
const importerUrl = new URL('../../scripts/import-open-place-catalogue.mjs', import.meta.url)

function executableSql(value) {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*--.*$/gm, '')
}

test('catalogue backfill never rewrites the locations table inside a migration transaction', async () => {
  const sql = executableSql(await readFile(migrationUrl, 'utf8'))

  assert.doesNotMatch(sql, /\bupdate\s+public\.locations\b/i)
  assert.doesNotMatch(sql, /\bdelete\s+from\s+public\.locations\b/i)
  assert.doesNotMatch(sql, /\binsert\s+into\s+public\.locations\b/i)
  assert.match(sql, /\bupdate\s+public\.catalogue_sync_regions\b/i)
  assert.match(sql, /status\s*=\s*'queued'/i)
})

test('catalogue replay uses bounded RPC transactions', async () => {
  const importer = await readFile(importerUrl, 'utf8')

  assert.match(importer, /const BATCH_SIZE = .*Number\(args\.get\('batch-size'\) \|\| 100\)/)
  assert.match(importer, /Math\.min\(200,/)
  assert.match(importer, /admin\.rpc\('upsert_open_catalogue_batch_v1'/)
  assert.match(importer, /if \(batch\.length >= BATCH_SIZE\) await flushBatch\(\)/)
})
