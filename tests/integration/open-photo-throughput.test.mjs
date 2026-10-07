import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('provider-aware photo workers publish to the private object store', async () => {
  const [runner, wikimedia, mapillary, karta, materializer, delivery] = await Promise.all([
    read('scripts/self-host-run-data-job.mjs'),
    read('scripts/global-data/build_wikimedia_candidates.py'),
    read('scripts/global-data/build_mapillary_candidates.py'),
    read('scripts/global-data/build_kartaview_candidates.py'),
    read('scripts/global-data/materialize_photo_candidates.py'),
    read('app/api/open-photo/[sha256]/route.js')
  ])
  assert.match(runner, /materialize_photo_candidates\.py/)
  assert.match(runner, /build_object_photo_search_overlay\.py/)
  assert.match(wikimedia, /REQUESTS_PER_MINUTE = max\(1, min\(200/)
  assert.match(mapillary, /DAILY_REQUEST_LIMIT = max\(1, min\(50_000/)
  assert.match(karta, /PROVIDER_HOURLY_MAX = 1000 if TOKEN else 100/)
  assert.match(materializer, /WIKIMEDIA_DOWNLOAD_CONCURRENCY/)
  assert.match(materializer, /MAPILLARY_GRAPH_REQUESTS_PER_MINUTE/)
  assert.match(materializer, /photos\/by-sha256/)
  assert.match(delivery, /downloadSelfHostObject/)
  assert.match(delivery, /actualHash !== hash/)
  assert.doesNotMatch(delivery, /authorizeB2|createAdminClient/)
})

test('materializer claims unique identity before upload and verifies canonical bytes', async () => {
  const [materializer, registry, historical, reconcile] = await Promise.all([
    read('scripts/global-data/materialize_photo_candidates.py'),
    read('supabase/migrations/10076_global_photo_uniqueness_registry.sql'),
    read('supabase/migrations/10077_seed_and_backfill_global_photo_fingerprints.sql'),
    read('scripts/global-data/reconcile_existing_global_photo_claims.py')
  ])
  assert.match(materializer, /claim_global_photo_v1/)
  assert.match(materializer, /finalize_global_photo_claim_v1/)
  assert.match(materializer, /release_global_photo_claim_v1/)
  assert.ok(materializer.indexOf('claim_photo(row, content_hash, perceptual, confirmation)') < materializer.indexOf('key = upload_media(normalized, content_hash)'))
  assert.match(materializer, /average_hash/)
  assert.match(materializer, /Object storage media SHA256 metadata verification failed/)
  assert.match(registry, /global_photo_claims_content_unique/)
  assert.match(registry, /global_photo_claims_provider_asset_unique/)
  assert.match(registry, /global_photo_claims_mih_0_idx/)
  assert.match(registry, /lease_expires_at/)
  assert.match(historical, /backfill_global_photo_fingerprint_v1/)
  assert.match(reconcile, /register_existing_global_photo_v1/)
})
