import assert from 'node:assert/strict'
import test from 'node:test'
import {
  crossSourceDuplicateScore,
  enrichmentStatusObjectKey,
  isEnrichmentStateSettled,
  mergeCanonicalPlaces,
  normalizedPlaceName,
  packEnrichmentStatusRow,
  staticSourceIdentity,
  unpackEnrichmentStatusRow,
  withStaticSourceProvenance
} from '../../lib/app/static-catalogue-launch.js'

function place(overrides = {}) {
  return {
    source: 'overture',
    sourcePlaceId: 'overture-1',
    sourceParentPlaceId: null,
    sourceUpdatedAt: '2026-08-04T00:00:00.000Z',
    sourceConfidence: 0.9,
    payloadHash: 'a'.repeat(64),
    name: 'The Example Café Inc.',
    kind: 'cafe',
    categoryConfidence: 0.98,
    addressPublic: '10 King Street West',
    city: 'Toronto',
    region: 'Ontario',
    country: 'Canada',
    countryCode: 'CA',
    latitude: 43.6501,
    longitude: -79.3801,
    websiteUrl: 'https://example.test',
    phonePublic: '+1 416 555 0100',
    openingHours: { monday: '09:00-17:00' },
    amenities: ['wifi'],
    accessibility: {},
    sourceMetadata: {},
    ...overrides
  }
}

test('normalizes names for cross-source comparison', () => {
  assert.equal(normalizedPlaceName('The Example Café Inc.'), 'example cafe')
})

test('deduplicates nearby Overture and FSQ records while preserving provenance', () => {
  const overture = withStaticSourceProvenance(place(), { partition: 'toronto' })
  const fsq = place({
    source: 'fsq_os',
    sourcePlaceId: 'fsq-1',
    name: 'Example Cafe',
    latitude: 43.65012,
    longitude: -79.38012,
    addressPublic: '10 King St W',
    sourceConfidence: 0.96,
    phonePublic: '4165550100',
    amenities: ['wifi', 'outdoor_seating']
  })
  const score = crossSourceDuplicateScore(overture, fsq)
  assert.ok(score)
  assert.ok(score.score >= 0.7)

  const merged = mergeCanonicalPlaces(overture, fsq, { partition: 'new-york' })
  assert.equal(merged.duplicate, true)
  assert.equal(merged.canonical.sourceMetadata.catalogueSources.length, 2)
  assert.deepEqual(merged.canonical.sourceMetadata.launchPartitions.sort(), ['new-york', 'toronto'])
  assert.ok(['overture:overture-1', 'fsq_os:fsq-1'].includes(staticSourceIdentity(merged.canonical)))
})

test('does not merge distant records with the same name', () => {
  const left = place()
  const right = place({ source: 'fsq_os', sourcePlaceId: 'fsq-2', latitude: 44.1, longitude: -79.38 })
  assert.equal(crossSourceDuplicateScore(left, right), null)
  assert.equal(mergeCanonicalPlaces(left, right), null)
})

test('treats an exact source identity as an idempotent update', () => {
  const current = place()
  const updated = place({ sourceConfidence: 0.99, websiteUrl: 'https://updated.example.test' })
  const merged = mergeCanonicalPlaces(current, updated, { partition: 'toronto' })
  assert.equal(merged.duplicate, false)
  assert.equal(merged.canonical.websiteUrl, 'https://updated.example.test')
  assert.equal(merged.canonical.sourceMetadata.catalogueSources.length, 1)
})

test('packs compact enrichment rows and recognizes settled states', () => {
  const row = packEnrichmentStatusRow('11111111-1111-5111-8111-111111111111', {
    photoState: 'matched',
    googleState: 'no_match',
    photoAttemptedAt: '2026-08-04T00:00:00.000Z'
  })
  const unpacked = unpackEnrichmentStatusRow(row)
  assert.equal(unpacked.photoState, 'matched')
  assert.equal(unpacked.googleState, 'no_match')
  assert.equal(isEnrichmentStateSettled(unpacked.photoState), true)
  assert.equal(isEnrichmentStateSettled('retryable_failure'), false)
  assert.equal(
    enrichmentStatusObjectKey('launch-2026-08', { z: 10, x: 301, y: 385 }),
    'catalogue/enrichment/launch-2026-08/10/301/385.json'
  )
})
