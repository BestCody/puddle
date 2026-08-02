import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL('../../supabase/migrations/10021_catalogue_quality_backfill.sql', import.meta.url)

function executableSql(value) {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*--.*$/gm, '')
}

test('catalogue backfill migration only requeues the bounded worker', async () => {
  const sql = executableSql(await readFile(migrationUrl, 'utf8'))
  const statements = sql.split(';').map((statement) => statement.trim()).filter(Boolean)

  assert.equal(statements.length, 1)
  assert.match(statements[0], /^update\s+public\.catalogue_sync_regions\b/i)
  assert.match(statements[0], /status\s*=\s*'queued'/i)
  assert.match(statements[0], /where\s+source\s*=\s*'overture'/i)
  assert.match(statements[0], /status\s+in\s*\(\s*'ready'\s*,\s*'empty'\s*\)/i)
  assert.doesNotMatch(sql, /\b(?:insert\s+into|update|delete\s+from)\s+public\.locations\b/i)
})
