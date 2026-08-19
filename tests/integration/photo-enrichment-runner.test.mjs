import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('global photo materialization runs hourly and can be dispatched manually', async () => {
  const workflow = await read('.github/workflows/global-photo-enrichment.yml')
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /\bschedule:/)
  assert.match(workflow, /cron: '31 \* \* \* \*'/)
  assert.doesNotMatch(workflow, /timeout-minutes:/)
  assert.match(workflow, /cancel-in-progress: false/)
})

test('global photo enrichment builds candidates from the active canonical snapshot', async () => {
  const workflow = await read('.github/workflows/global-photo-enrichment.yml')
  assert.match(workflow, /python scripts\/global-data\/active_snapshot\.py/)
  assert.match(workflow, /build_wikimedia_candidates\.py/)
  assert.match(workflow, /build_mapillary_candidates\.py/)
  assert.match(workflow, /steps\.active\.outputs\.snapshot/)
})

test('selected licensed photos materialize directly into immutable B2 media', async () => {
  const workflow = await read('.github/workflows/global-photo-enrichment.yml')
  const materializer = await read('scripts/global-data/materialize_photo_candidates.py')
  assert.match(workflow, /B2_MEDIA_OPEN_PHOTO_PREFIX/)
  assert.match(workflow, /media\/photos\/by-sha256/)
  assert.match(workflow, /materialize_photo_candidates\.py/)
  assert.match(materializer, /sha256/i)
  assert.match(materializer, /B2_MEDIA_OPEN_PHOTO_PREFIX/)
})

test('materializer tolerates pre-B2 bootstrap photo metadata without content hashes', async () => {
  const materializer = await read('scripts/global-data/materialize_photo_candidates.py')
  assert.match(materializer, /DESCRIBE SELECT \* FROM read_parquet/)
  assert.match(materializer, /'content_hash' in bootstrap_columns/)
  assert.match(materializer, /ignoring legacy bootstrap photo metadata without content_hash/)
  assert.match(materializer, /'content_hash' in enriched_columns/)
})

test('retired relational photo enrichment is not part of the production pipeline', async () => {
  const repositoryCheck = await read('scripts/check.mjs')
  const packageJson = JSON.parse(await read('package.json'))
  assert.match(repositoryCheck, /scripts\/enrich-open-location-photos\.mjs/)
  assert.match(repositoryCheck, /\.github\/workflows\/photo-enrichment\.yml/)
  assert.equal(packageJson.scripts?.['locations:photos'], undefined)
  assert.equal(packageJson.scripts?.['locations:photos:migrate-b2'], undefined)
})
