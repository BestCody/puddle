import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function source(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
}

test('existing B2 photos are reconciled once and retired identities cannot resurface', async () => {
  const workflow = await source('.github/workflows/global-photo-enrichment.yml')
  const reconcile = await source('scripts/global-data/reconcile_existing_global_photo_claims.py')
  const materializer = await source('scripts/global-data/materialize_photo_candidates.py')
  const canonicalSearch = await source('scripts/global-data/location_search_common.py')
  const b2Indexer = await source('scripts/global-data/build_b2_search_index.py')
  const registration = await source('supabase/migrations/10079_reconcile_existing_global_photo_claims.sql')
  const candidateRegistry = await source('supabase/migrations/20260826200000_global_photo_candidate_registry.sql')
  const retirement = await source('supabase/migrations/20260819062549_retire_legacy_photo_source_helpers.sql')

  assert.doesNotMatch(workflow, /sync_retired_photo_exclusions\.py/)
  assert.doesNotMatch(workflow, /backfill_global_photo_fingerprints\.py/)
  assert.match(workflow, /reconcile_existing_global_photo_claims\.py/)
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

  assert.match(retirement, /drop function if exists public\.list_retired_b2_photo_exclusions_v1\(integer\)/)
  assert.match(retirement, /drop function if exists public\.retire_duplicate_global_photo_claim_v1\(uuid, text\)/)
  assert.match(materializer, /photo_exclusions/)
  assert.match(materializer, /x\.location_id=e\.location_id AND x\.content_hash=e\.content_hash/)
  assert.match(materializer, /def object_exists\(key\):/)
  assert.match(materializer, /if object_exists\(bootstrap_photo\):/)
  assert.doesNotMatch(materializer, /prefix_exists\(bootstrap_photo\.rsplit/)

  // Candidate identity is claimed before provider details or image bytes are
  // fetched, while the authoritative hash registry remains the final gate.
  assert.match(candidateRegistry, /global_photo_candidate_registry/)
  assert.match(candidateRegistry, /unique index if not exists global_photo_candidate_registry_url_unique_idx/)
  assert.match(candidateRegistry, /reserve_global_photo_candidate_v1/)
  assert.match(candidateRegistry, /bind_global_photo_candidate_url_v1/)
  assert.match(candidateRegistry, /complete_global_photo_candidate_v1/)
  assert.match(candidateRegistry, /candidate_lease_active/)
  assert.match(candidateRegistry, /provider_asset_already_materialized/)
  assert.match(materializer, /reserve_global_photo_candidate_v1/)
  assert.match(materializer, /bind_global_photo_candidate_url_v1/)
  assert.match(materializer, /normalize_source_url/)
  assert.match(materializer, /complete_global_photo_candidate_v1/)
  assert.ok(materializer.indexOf('reservation = reserve_candidate(row)') < materializer.indexOf('prepare_candidate(row, candidate)'))
  assert.match(materializer, /Fingerprints must describe the exact canonical bytes written to B2/)
  assert.match(materializer, /with Image\.open\(io\.BytesIO\(data\)\) as canonical/)
  assert.ok(materializer.indexOf("image.save(out, format='JPEG'") < materializer.indexOf('perceptual = dhash(canonical)'))

  // B2 serving consumes the shared canonical projection so photo retirement semantics cannot drift.
  assert.match(canonicalSearch, /photo_exclusion_glob/)
  assert.match(canonicalSearch, /photo_union_raw/)
  assert.match(canonicalSearch, /x\.location_id=cast\(p\.location_id AS VARCHAR\)/)
  assert.match(canonicalSearch, /x\.content_hash=lower\(cast\(p\.content_hash AS VARCHAR\)\)/)
  assert.match(b2Indexer, /canonical_query/)
  assert.match(b2Indexer, /document_from_values/)
})
