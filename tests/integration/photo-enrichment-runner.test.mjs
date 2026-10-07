import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('host jobs reconcile claims before materializing and publish the photo overlay afterward', async () => {
  const runner = await read('scripts/self-host-run-data-job.mjs')
  const reconcile = runner.indexOf("python('reconcile_existing_global_photo_claims.py'")
  const materialize = runner.indexOf("python('materialize_photo_candidates.py'")
  const overlay = runner.indexOf("python('build_object_photo_search_overlay.py'")
  assert.ok(reconcile >= 0 && reconcile < materialize && materialize < overlay)
  assert.match(runner, /PUDDLE_JOBS_ENABLED/)
  assert.match(runner, /PUDDLE_STORAGE_CUTOVER_COMPLETE/)
  assert.match(runner, /PUDDLE_SUPABASE_CUTOVER_COMPLETE/)
  assert.doesNotMatch(runner, /B2_/)
})

test('location rebuild carries photo state before activating the index', async () => {
  const runner = await read('scripts/self-host-run-data-job.mjs')
  const carry = runner.indexOf("python('carry_photo_enrichment.py'")
  const bootstrap = runner.indexOf("python('build_bootstrap_overlays.py'")
  const index = runner.indexOf("python('build_object_search_index.py'")
  const validate = runner.indexOf("python('validate_object_search_index.py'")
  assert.ok(carry >= 0 && carry < bootstrap && bootstrap < index && index < validate)
  const carrier = await read('scripts/global-data/carry_photo_enrichment.py')
  assert.match(carrier, /photo_metadata/)
  assert.match(carrier, /photo_exclusions/)
  assert.match(carrier, /copy_object/)
})

test('photo materialization is resumable and bounded by provider budgets, not a total-location cap', async () => {
  const materializer = await read('scripts/global-data/materialize_photo_candidates.py')
  const runner = await read('scripts/self-host-run-data-job.mjs')
  for (const marker of [
    'PUDDLE_OPEN_PHOTO_PREFIX', 'photo_attempts', 'retryable_error', 'HTTP_POOL',
    'redirect=False', 'MAX_SOURCE_PIXELS', 'candidate_batches(query',
    'claim_global_photo_v1', 'finalize_global_photo_claim_v1'
  ]) assert.ok(materializer.includes(marker), `Missing materializer guard: ${marker}`)
  assert.match(materializer, /WHERE location_id > '\{escaped_cursor\}'/)
  assert.doesNotMatch(materializer, /parser\.add_argument\('--limit'/)
  assert.doesNotMatch(materializer, /min\(10_000|min\(100_000/)
  assert.match(runner, /GLOBAL_PHOTO_RUN_BUDGET_SECONDS/)
  assert.match(runner, /WIKIMEDIA_REQUESTS_PER_MINUTE/)
  assert.match(runner, /MAPILLARY_TILE_DAILY_LIMIT/)
  assert.match(runner, /KARTAVIEW_REQUESTS_PER_HOUR/)
})

test('inventory audit is read-only and repair utilities preserve photo bytes', async () => {
  const audit = await read('scripts/global-data/audit_object_photo_inventory.py')
  const repairRefs = await read('scripts/global-data/repair_object_photo_references.py')
  const repairMetadata = await read('scripts/global-data/repair_object_photo_inventory.py')
  for (const marker of ['list_objects_v2', 'head_object', 'get_object', 'hashlib.sha256', 'Image.open']) {
    assert.ok(audit.includes(marker), `Missing inventory check: ${marker}`)
  }
  assert.doesNotMatch(audit, /(?:put|copy|delete)_object|upload_file|supabase_rpc/i)
  assert.match(repairRefs, /missing_canonical_object/)
  assert.match(repairRefs, /put_object/)
  assert.match(repairRefs, /objectsRemoved.*0/)
  assert.doesNotMatch(repairRefs, /delete_object|delete_objects|remove_objects/i)
  assert.match(repairMetadata, /MetadataDirective.*REPLACE/)
  assert.match(repairMetadata, /objectsRemoved.*0/)
  assert.doesNotMatch(repairMetadata, /delete_object|delete_objects|remove\(/i)
})

test('provider throttles and checkpoints remain in the host workers', async () => {
  const wikimedia = await read('scripts/global-data/build_wikimedia_candidates.py')
  const mapillary = await read('scripts/global-data/build_mapillary_candidates.py')
  const karta = await read('scripts/global-data/build_kartaview_candidates.py')
  assert.match(wikimedia, /REQUESTS_PER_MINUTE = max\(1, min\(200/)
  assert.match(wikimedia, /RUN_BUDGET_SECONDS/)
  assert.match(mapillary, /DAILY_REQUEST_LIMIT = max\(1, min\(50_000/)
  assert.match(mapillary, /reserve_daily_budget/)
  assert.match(mapillary, /release_unused_budget/)
  assert.match(karta, /PROVIDER_HOURLY_MAX = 1000 if TOKEN else 100/)
  assert.match(karta, /CHECKPOINT_EVERY/)
  assert.match(karta, /attempted_since_checkpoint/)
})

test('internal-table RLS decisions remain encoded in migration history', async () => {
  const migration = await read('supabase/migrations/20260826190000_intentional_rls_for_internal_tables.sql')
  for (const table of ['location_save_counts', 'location_save_density_tiles']) {
    assert.match(migration, new RegExp(`alter table if exists public\\.${table} enable row level security`))
  }
  assert.match(migration, /spatial_ref_sys_read/)
  assert.match(migration, /grant select on table public\.spatial_ref_sys to public/)
})
