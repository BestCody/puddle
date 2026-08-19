import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function source(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
}

test('existing B2 photos are reconciled once and retired identities cannot resurface', async () => {
  const workflow = await source('.github/workflows/global-photo-enrichment.yml')
  const reconcile = await source('scripts/global-data/reconcile_existing_global_photo_claims.py')
  const syncExclusions = await source('scripts/global-data/sync_retired_photo_exclusions.py')
  const materializer = await source('scripts/global-data/materialize_photo_candidates.py')
  const indexer = await source('scripts/global-data/index_opensearch.py')
  const registration = await source('supabase/migrations/10079_reconcile_existing_global_photo_claims.sql')
  const exclusionFeed = await source('supabase/migrations/10078_global_photo_exclusion_feed.sql')

  assert.match(workflow, /sync_retired_photo_exclusions\.py/)
  assert.match(workflow, /backfill_global_photo_fingerprints\.py/)
  assert.match(workflow, /reconcile_existing_global_photo_claims\.py/)
  assert.ok(workflow.indexOf('backfill_global_photo_fingerprints.py') < workflow.indexOf('reconcile_existing_global_photo_claims.py'))
  assert.ok(workflow.indexOf('reconcile_existing_global_photo_claims.py') < workflow.indexOf('materialize_photo_candidates.py'))

  assert.match(reconcile, /existing-global-reconciled-v1\.json/)
  assert.match(reconcile, /state_complete\(\)/)
  assert.match(reconcile, /JOIN read_parquet\('\{loc\}'\) l ON cast\(l\.id AS VARCHAR\)=cast\(p\.location_id AS VARCHAR\)/)
  assert.match(reconcile, /B2 SHA-256 mismatch/)
  assert.match(reconcile, /register_existing_global_photo_v1/)
  assert.match(reconcile, /noncanonical_existing_global_photo/)
  assert.match(reconcile, /existing-global-\{safe\}\.parquet/)

  assert.match(registration, /global_photo_claims/)
  assert.match(registration, /already_registered/)
  assert.match(registration, /location_has_different_photo/)
  assert.match(registration, /exact_duplicate/)
  assert.match(registration, /provider_asset_duplicate/)
  assert.match(registration, /near_duplicate/)
  assert.match(registration, /bit_count\(g\.perceptual_hash # v_perceptual\)<=5/)
  assert.match(registration, /pg_advisory_xact_lock\(19370001,v_lock_key\)/)

  assert.match(exclusionFeed, /list_retired_b2_photo_exclusions_v1/)
  assert.match(syncExclusions, /retired-relational\.parquet/)
  assert.match(materializer, /photo_exclusions/)
  assert.match(materializer, /x\.location_id=e\.location_id AND x\.content_hash=e\.content_hash/)
  assert.match(materializer, /def object_exists\(key\):/)
  assert.match(materializer, /if object_exists\(bootstrap_photo\):/)
  assert.doesNotMatch(materializer, /prefix_exists\(bootstrap_photo\.rsplit/)
  assert.match(indexer, /photo_exclusion_glob/)
  assert.match(indexer, /photo_union_raw/)
  assert.match(indexer, /x\.location_id=cast\(p\.location_id AS VARCHAR\)/)
  assert.match(indexer, /x\.content_hash=lower\(cast\(p\.content_hash AS VARCHAR\)\)/)
})
