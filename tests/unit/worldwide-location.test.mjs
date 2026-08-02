import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { catalogueBoundingBoxes } from '../../lib/app/catalogue-regions.js'
import { normalizeGeocodingResult } from '../../lib/app/geocoding.js'
import { convertJsonSequenceToJsonLines, normalizeJsonSequenceLine } from '../../lib/app/json-sequence.js'
import { normalizeOpenPlaceRecord } from '../../lib/app/open-place-catalogue.js'
import { profileLocationFromForm } from '../../lib/app/profile-location.js'

test('normalizes a worldwide geocoding result', () => {
  const result = normalizeGeocodingResult({
    city: 'Tokyo',
    state: 'Tokyo',
    country: 'Japan',
    country_code: 'jp',
    lat: 35.6762,
    lon: 139.6503,
    timezone: { name: 'Asia/Tokyo' },
    place_id: 'tokyo-city'
  })
  assert.deepEqual(result, {
    providerId: 'tokyo-city',
    city: 'Tokyo',
    region: 'Tokyo',
    country: 'Japan',
    countryCode: 'JP',
    latitude: 35.6762,
    longitude: 139.6503,
    timezone: 'Asia/Tokyo',
    label: 'Tokyo, Japan',
    confidence: null,
    resultType: 'city'
  })
})

test('accepts a selected city with coordinates for a profile', () => {
  const form = new FormData()
  form.set('city', 'Paris')
  form.set('region', 'Île-de-France')
  form.set('country', 'France')
  form.set('country_code', 'fr')
  form.set('latitude', '48.8566')
  form.set('longitude', '2.3522')
  form.set('timezone', 'Europe/Paris')
  form.set('location_label', 'Paris, Île-de-France, France')
  form.set('location_source', 'city_search')

  const result = profileLocationFromForm(form)
  assert.equal(result.city, 'Paris')
  assert.equal(result.country_code, 'FR')
  assert.equal(result.latitude, 48.8566)
  assert.equal(result.longitude, 2.3522)
  assert.equal(result.timezone, 'Europe/Paris')
  assert.equal(result.location_source, 'city_search')
})

test('rejects city text without coordinates', () => {
  const form = new FormData()
  form.set('city', 'London')
  assert.throws(() => profileLocationFromForm(form), /Choose a city or use your current location/)
})

test('normalizes GeoJSON text sequence records without loading a collection', () => {
  assert.equal(normalizeJsonSequenceLine('\u001e{"type":"Feature","id":"one"}'), '{"type":"Feature","id":"one"}')
  assert.equal(normalizeJsonSequenceLine('\uFEFF\u001e{"type":"Feature","id":"two"}\r'), '{"type":"Feature","id":"two"}')
  assert.equal(normalizeJsonSequenceLine('   '), '')
})

test('streams and combines GeoJSON text sequences into JSON Lines', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'puddle-json-sequence-test-'))
  const first = join(directory, 'places-1.geojsonseq')
  const second = join(directory, 'places-2.geojsonseq')
  const output = join(directory, 'places.jsonl')
  try {
    await writeFile(first, '\u001e{"type":"Feature","id":"one"}\n', 'utf8')
    await writeFile(second, '\u001e{"type":"Feature","id":"two"}\n', 'utf8')
    const count = await convertJsonSequenceToJsonLines([first, second], output)
    assert.equal(count, 2)
    assert.equal(await readFile(output, 'utf8'), '{"type":"Feature","id":"one"}\n{"type":"Feature","id":"two"}\n')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

function overtureFeature(overrides = {}) {
  return {
    type: 'Feature',
    id: 'overture-place-one',
    geometry: { type: 'Point', coordinates: [-79.648, 43.4791] },
    properties: {
      id: 'overture-place-one',
      names: { primary: 'Lakeside Coffee' },
      basic_category: 'cafe',
      taxonomy: {
        primary: 'coffee_shop',
        hierarchy: ['food_and_drink', 'cafe', 'coffee_shop'],
        alternates: ['bakery']
      },
      operating_status: 'open',
      confidence: 0.97,
      addresses: [{
        freeform: '123 Lakeshore Road',
        locality: 'Oakville',
        region: 'Ontario',
        country: 'CA'
      }],
      sources: [{ update_time: '2026-06-17T00:00:00Z', confidence: 0.97 }],
      ...overrides
    }
  }
}

test('normalizes a current Overture place feature', () => {
  const result = normalizeOpenPlaceRecord(overtureFeature(), 'overture')
  assert.equal(result.rejectionReason, null)
  assert.equal(result.item.sourcePlaceId, 'overture-place-one')
  assert.equal(result.item.kind, 'cafe')
  assert.equal(result.item.city, 'Oakville')
  assert.equal(result.item.countryCode, 'CA')
  assert.equal(result.item.latitude, 43.4791)
  assert.equal(result.item.longitude, -79.648)
})

test('does not misclassify barber shops as bars', () => {
  const result = normalizeOpenPlaceRecord(overtureFeature({
    names: { primary: 'Main Street Barber' },
    basic_category: 'barber_shop',
    taxonomy: { primary: 'barber_shop', hierarchy: ['personal_service', 'barber_shop'], alternates: [] }
  }), 'overture')
  assert.equal(result.item, null)
  assert.equal(result.rejectionReason, 'unsupported_category')
})

test('rejects temporarily closed Overture places', () => {
  const result = normalizeOpenPlaceRecord(overtureFeature({ operating_status: 'temporarily_closed' }), 'overture')
  assert.equal(result.item, null)
  assert.equal(result.rejectionReason, 'closed')
})

test('splits catalogue regions that cross the international date line', () => {
  const boxes = catalogueBoundingBoxes({ center_latitude: 0, center_longitude: 179.9, radius_km: 100 })
  assert.equal(boxes.length, 2)
  assert.equal(boxes[0][2], 180)
  assert.equal(boxes[1][0], -180)
  for (const box of boxes) {
    assert.ok(box[0] >= -180 && box[2] <= 180)
    assert.ok(box[0] < box[2])
  }
})

test('uses a world-spanning longitude range near the poles', () => {
  const boxes = catalogueBoundingBoxes({ center_latitude: 89.9, center_longitude: 40, radius_km: 100 })
  assert.deepEqual(boxes[0].slice(0, 3), [-180, boxes[0][1], 180])
  assert.equal(boxes.length, 1)
})
