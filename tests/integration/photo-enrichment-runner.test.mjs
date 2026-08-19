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

test('provider rate limits match upstream contracts', async () => {
  const materializeWorkflow = await read('.github/workflows/global-photo-enrichment.yml')
  const materializer = await read('scripts/global-data/materialize_photo_candidates.py')
  const wikimediaWorkflow = await read('.github/workflows/global-wikimedia-enrichment.yml')
  const wikimedia = await read('scripts/global-data/build_wikimedia_candidates.py')
  const mapillaryWorkflow = await read('.github/workflows/global-mapillary-enrichment.yml')
  const mapillary = await read('scripts/global-data/build_mapillary_candidates.py')
  const kartaWorkflow = await read('.github/workflows/global-kartaview-enrichment.yml')
  const karta = await read('scripts/global-data/build_kartaview_candidates.py')

  assert.match(materializeWorkflow, /GLOBAL_PHOTO_DOWNLOAD_CONCURRENCY: '192'/)
  assert.match(materializeWorkflow, /GLOBAL_PHOTO_WIKIMEDIA_DOWNLOAD_CONCURRENCY: '2'/)
  assert.match(materializeWorkflow, /GLOBAL_PHOTO_WIKIMEDIA_DOWNLOAD_MBIT: '25'/)
  assert.match(materializeWorkflow, /MAPILLARY_GRAPH_REQUESTS_PER_MINUTE: '50000'/)
  assert.match(materializer, /WIKIMEDIA_DOWNLOAD_CONCURRENCY/)
  assert.match(materializer, /WIKIMEDIA_DOWNLOAD_MBIT/)
  assert.match(materializer, /MAPILLARY_GRAPH_REQUESTS_PER_MINUTE/)
  assert.match(materializer, /Authorization': f'OAuth/)
  assert.match(materializer, /Retry-After/)

  assert.match(wikimediaWorkflow, /WIKIMEDIA_REQUESTS_PER_MINUTE: '200'/)
  assert.match(wikimedia, /min\(200, int\(os\.getenv\('WIKIMEDIA_REQUESTS_PER_MINUTE'/)
  assert.match(wikimedia, /3 if ACCESS_TOKEN else 1/)
  assert.match(wikimedia, /'iiurlwidth': '1920'/)
  assert.match(wikimedia, /'Accept-Encoding': 'gzip'/)
  assert.match(wikimedia, /gate\.defer\(5\.0\)/)

  assert.match(mapillaryWorkflow, /default: '50000'/)
  assert.match(mapillaryWorkflow, /MAPILLARY_TILE_DAILY_LIMIT: '50000'/)
  assert.match(mapillary, /DAILY_REQUEST_LIMIT = max\(1, min\(50_000/)
  assert.match(mapillary, /reserve_daily_budget/)
  assert.match(mapillary, /release_unused_budget/)

  assert.match(kartaWorkflow, /default: '1000'/)
  assert.match(kartaWorkflow, /KARTAVIEW_REQUESTS_PER_HOUR: .*'1000'/)
  assert.match(karta, /PROVIDER_HOURLY_MAX = 1000 if TOKEN else 100/)
  assert.match(karta, /START_INTERVAL = 3600\.0 \/ REQUESTS_PER_HOUR/)
  assert.match(karta, /Retry-After/)
})
