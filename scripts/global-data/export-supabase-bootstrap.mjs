import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { once } from 'node:events'
import { createAdminClient } from '../../lib/supabase/admin.js'

const output = path.resolve(process.argv.find((value) => value.startsWith('--out='))?.split('=')[1] || process.env.GLOBAL_BOOTSTRAP_OUT || '.global-data/bootstrap-jsonl')
const PAGE_SIZE = Math.max(100, Math.min(5_000, Number(process.env.GLOBAL_BOOTSTRAP_PAGE_SIZE || 1_000)))

// Range pagination must have a deterministic, unique ordering. Without it,
// PostgreSQL is free to return rows in a different order on each request and
// adjacent pages can overlap or skip rows. Use each table's primary/unique key.
const TABLES = [
  { name: 'locations', order: ['id'] },
  { name: 'location_source_links', order: ['source', 'source_place_id'] },
  { name: 'location_descriptions', order: ['location_id', 'source'] },
  { name: 'location_photo_sources', order: ['id'] },
  { name: 'media_objects', order: ['id'] },
  { name: 'location_google_places', order: ['location_id'] },
  { name: 'catalogue_region_locations', order: ['region_id', 'source', 'source_place_id'] }
]

await mkdir(output, { recursive: true })
const admin = createAdminClient()
const manifest = { generatedAt: new Date().toISOString(), schemaVersion: 1, tables: {} }

for (const { name: table, order } of TABLES) {
  const file = path.join(output, `${table}.ndjson`)
  const stream = createWriteStream(file, { encoding: 'utf8' })
  let rows = 0
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = admin.from(table).select('*')
    for (const column of order) query = query.order(column, { ascending: true })
    const result = await query.range(offset, offset + PAGE_SIZE - 1)
    if (result.error) throw new Error(`${table} export failed at offset ${offset}: ${result.error.message}`)
    const batch = result.data || []
    for (const row of batch) {
      if (!stream.write(`${JSON.stringify(row)}\n`)) await once(stream, 'drain')
      rows += 1
    }
    if (batch.length < PAGE_SIZE) break
  }
  stream.end()
  await once(stream, 'finish')
  manifest.tables[table] = { rows, file: `${table}.ndjson`, order }
  console.log(`exported ${rows} rows from ${table}`)
}

await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify(manifest, null, 2))
