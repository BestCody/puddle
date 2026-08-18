import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function source(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
}

test('global photo enrichment is coverage-first and writes content-addressed B2 media', async () => {
  const workflow = await source('.github/workflows/global-photo-enrichment.yml')
  const wikimedia = await source('scripts/global-data/build_wikimedia_candidates.py')
  const mapillary = await source('scripts/global-data/build_mapillary_candidates.py')
  const kartaview = await source('scripts/global-data/build_kartaview_candidates.py')
  const kartaWorkflow = await source('.github/workflows/global-kartaview-enrichment.yml')
  const materializer = await source('scripts/global-data/materialize_photo_candidates.py')
  const delivery = await source('app/api/open-photo/[sha256]/route.js')

  assert.match(workflow, /GLOBAL_PHOTO_PIPELINE_ENABLED/)
  assert.match(workflow, /WIKIMEDIA_REQUESTS_PER_MINUTE/)
  assert.match(workflow, /MAPILLARY_TILE_CONCURRENCY/)
  assert.match(workflow, /GLOBAL_PHOTO_DOWNLOAD_CONCURRENCY/)
  assert.match(wikimedia, /occupied Wikimedia cells/)
  assert.match(wikimedia, /REQUESTS_PER_MINUTE = max\(1, min\(2000/)
  assert.match(mapillary, /zoom-14 vector tiles/)
  assert.match(mapillary, /ThreadPoolExecutor\(max_workers=CONCURRENCY\)/)
  assert.match(kartaview, /REQUESTS_PER_HOUR = max\(1, min\(1000 if TOKEN else 100/)
  assert.match(kartaWorkflow, /KARTAVIEW_REQUESTS_PER_HOUR: '1000'/)
  assert.match(materializer, /existing_photos/)
  assert.match(materializer, /media\/photos\/by-sha256/)
  assert.match(materializer, /content_hash/)

  assert.match(delivery, /canonicalStorageKey/)
  assert.match(delivery, /media\/photos\/by-sha256/)
  assert.match(delivery, /actualHash !== hash/)
  assert.doesNotMatch(delivery, /from\('media_objects'\)/)
})
