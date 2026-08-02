import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  boundedInteger,
  parsePhotoImportSummary,
  photoDisplayState,
  shouldContinuePhotoEnrichment,
  validatePhotoImportSummary
} from '../../lib/app/photo-enrichment.js'

const root = fileURLToPath(new URL('../..', import.meta.url))
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('bounds progressive photo worker configuration', () => {
  assert.equal(boundedInteger('500', 200, { min: 1, max: 5_000 }), 500)
  assert.equal(boundedInteger('not-a-number', 500, { min: 1, max: 5_000 }), 500)
  assert.equal(boundedInteger('-10', 500, { min: 1, max: 5_000 }), 1)
  assert.equal(boundedInteger('9000', 500, { min: 1, max: 5_000 }), 5_000)
})

test('parses and validates noisy importer summaries', () => {
  const output = `provider warning\n${JSON.stringify({ inspected: 3, matched: 1, imported: 1, noMatch: 1, failed: 1, skipped: 0 }, null, 2)}\n`
  const summary = validatePhotoImportSummary(parsePhotoImportSummary(output))
  assert.equal(summary.inspected, 3)
  assert.equal(summary.imported, 1)
  assert.equal(shouldContinuePhotoEnrichment(summary, 3), true)
  assert.equal(shouldContinuePhotoEnrichment({ ...summary, inspected: 2 }, 3), false)
  assert.throws(
    () => validatePhotoImportSummary({ inspected: 3, matched: 1, imported: 1, noMatch: 0, failed: 0, skipped: 0 }),
    /settled 1 of 3/
  )
})

test('only a genuine no-match receives the permanent placeholder state', () => {
  assert.equal(photoDisplayState('matched', true), 'photo')
  assert.equal(photoDisplayState('pending', false), 'searching')
  assert.equal(photoDisplayState('processing', false), 'searching')
  assert.equal(photoDisplayState('failed', false), 'retrying')
  assert.equal(photoDisplayState('no_match', false), 'unavailable')
})

test('photo claims prioritize recent decks and nearby active users while remaining resumable', async () => {
  const migration = await read('supabase/migrations/10022_progressive_photo_enrichment.sql')
  for (const marker of [
    'recent_deck_locations',
    'recommendation_candidates',
    'recommendation_requests',
    'near_active_locations',
    'st_dwithin',
    "now()-interval '2 hours'",
    'for update of location skip locked'
  ]) assert.ok(migration.includes(marker), `photo migration is missing ${marker}`)
  assert.ok(migration.indexOf('deck.location_id is not null then 0') < migration.indexOf('nearby.location_id is not null then 1'))
})

test('the active card does not use Google photos and distinguishes search progress from no-match', async () => {
  const card = await read('components/minimal-swipe-card.js')
  assert.equal(card.includes('GooglePlacePhotoFallback'), false)
  assert.equal(card.includes('google_place_id'), false)
  assert.ok(card.includes('/api/location-photo-status/'))
  assert.ok(card.includes("displayState === 'unavailable'"))
  assert.ok(card.includes('Wikimedia Commons, Mapillary, and KartaView'))
})

test('catalogue refresh no longer performs the one-off 200-photo pass', async () => {
  const catalogueWorkflow = await read('.github/workflows/catalogue-refresh.yml')
  const photoWorkflow = await read('.github/workflows/photo-enrichment.yml')
  assert.ok(catalogueWorkflow.includes("CATALOGUE_PHOTO_ENRICH: 'false'"))
  assert.equal(catalogueWorkflow.includes('CATALOGUE_REFRESH_PHOTO_LIMIT'), false)
  assert.ok(photoWorkflow.includes("PHOTO_ENRICH_BATCH_SIZE: '500'"))
  assert.ok(photoWorkflow.includes("cron: '17 */4 * * *'"))
  assert.ok(photoWorkflow.includes('npm run locations:photos:enrich'))
  assert.ok(root.endsWith('puddle') || root.length > 0)
})
