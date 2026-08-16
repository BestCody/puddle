import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { once } from 'node:events'
import { createAdminClient } from '../../lib/supabase/admin.js'

const output = path.resolve(process.argv.find((value) => value.startsWith('--out='))?.split('=')[1] || process.env.GLOBAL_BOOTSTRAP_OUT || '.global-data/bootstrap-jsonl')
const PAGE_SIZE = Math.max(100, Math.min(5_000, Number(process.env.GLOBAL_BOOTSTRAP_PAGE_SIZE || 1_000)))
const TABLES = [
  'locations',
  'location_source_links',
  'location_descriptions',
  'location_photo_sources',
  'location_google_places',
  'catalogue_region_locations'
]

await mkdir(output, { recursive: true })
const admin = createAdminClient()
const manifest = { generatedAt: new Date().toISOString(), schemaVersion: 1, tables: {} }

for (const table of TABLES) {
  const file = path.join(output, `${table}.ndjson`)
  const stream = createWriteStream(file, { encoding: 'utf8' })
  let rows = 0
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await admin.from(table).select('*').range(offset, offset + PAGE_SIZE - 1)
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
  manifest.tables[table] = { rows, file: `${table}.ndjson` }
  console.log(`exported ${rows} rows from ${table}`)
}

await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify(manifest, null, 2))
