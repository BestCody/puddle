import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { normalizeGeocodingResult } from '../../lib/app/geocoding.js'
import { convertJsonSequenceToJsonLines, normalizeJsonSequenceLine } from '../../lib/app/json-sequence.js'
import { normalizeGlobalLocationViewport } from '../../lib/app/global-location-search.js'
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

test('accepts a viewport that crosses the international date line', () => {
  const viewport = normalizeGlobalLocationViewport({
    north: 15,
    south: -15,
    west: 170,
    east: -170,
    zoom: 6
  })
  assert.equal(viewport.west, 170)
  assert.equal(viewport.east, -170)
  assert.equal(viewport.zoom, 6)
})
