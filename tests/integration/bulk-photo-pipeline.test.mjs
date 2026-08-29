import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const read = (path) => readFile(join(root, path), 'utf8')

test('bulk photo datasets share the canonical metadata-to-B2 pipeline', async () => {
  const builder = await read('scripts/global-data/build_bulk_photo_manifest.py')
  const materializer = await read('scripts/global-data/materialize_photo_candidates.py')
  const migration = await read('supabase/migrations/20260828120000_bulk_photo_provider.sql')
  const applyWorkflow = await read('.github/workflows/apply-global-photo-candidate-registry.yml')
  const pilotWorkflow = await read('.github/workflows/run-canonical-photo-pilot.yml')
  const packageJson = JSON.parse(await read('package.json'))

  assert.match(builder, /iter_osv/)
  assert.match(builder, /iter_msls/)
  assert.match(builder, /iter_yfcc/)
  assert.ok(builder.includes('YFCC_COLUMNS = [\n    "photo_id",\n    "user_id"'))
  assert.match(builder, /YFCC_LEADING_ROW_COLUMNS/)
  assert.match(builder, /unsupported YFCC metadata row width/)
  assert.match(builder, /source_candidates/)
  assert.match(builder, /max-records.*pilot/i)
  assert.match(builder, /CC-BY-SA/)
  assert.match(builder, /source_dataset/)
  assert.match(builder, /COPY \(SELECT \* FROM bulk_photo_manifest/)
  assert.doesNotMatch(builder, /max[_-]locations/)

  assert.match(materializer, /--bulk-manifest/)
  assert.match(materializer, /read_local_image/)
  assert.match(materializer, /PROVIDER_CODES = .*'yfcc100m': 4/)
  assert.match(materializer, /source_dataset/)
  assert.match(materializer, /get_global_photo_candidate_v1/)
  assert.match(materializer, /candidate_rank <= \{FALLBACK_CANDIDATES\}/)

  assert.match(migration, /provider_code between 1 and 4/)
  assert.match(migration, /when 4 then ''yfcc100m''/)
  assert.match(migration, /get_global_photo_candidate_v1/)
  assert.match(applyWorkflow, /20260828120000_bulk_photo_provider\.sql/)
  assert.match(pilotWorkflow, /20260828120000_bulk_photo_provider\.sql/)
  assert.equal(typeof packageJson.scripts?.['global:photos:bulk'], 'string')
  assert.equal(typeof packageJson.scripts?.['global:photos:overlay'], 'string')
})
