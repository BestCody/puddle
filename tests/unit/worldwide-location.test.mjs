import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeGlobalLocationViewport } from '../../lib/app/global-location-search.js'
import { profileLocationFromForm } from '../../lib/app/profile-location.js'
import { resolveDiscoveryCenter } from '../../lib/app/discovery-filters.js'
import { optionalNumber, validCoordinates } from '../../lib/app/optional-number.js'

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

test('empty coordinates stay absent while actual zero coordinates remain valid', () => {
  assert.equal(optionalNumber(null), null)
  assert.equal(optionalNumber(''), null)
  assert.equal(optionalNumber('   '), null)
  assert.equal(optionalNumber([]), null)
  assert.equal(optionalNumber({ valueOf: () => 0 }), null)
  assert.equal(optionalNumber('0'), 0)
  assert.equal(validCoordinates(null, null), null)
  assert.equal(validCoordinates('', ''), null)
  assert.deepEqual(validCoordinates('0', '0'), { latitude: 0, longitude: 0 })
  assert.equal(resolveDiscoveryCenter({ latitude: null, longitude: null }, { latitude: null, longitude: null }), null)
  assert.deepEqual(resolveDiscoveryCenter({ latitude: 0, longitude: 0 }, {}), { latitude: 0, longitude: 0 })
  assert.equal(resolveDiscoveryCenter({ latitude: 91, longitude: 0 }, {}), null)

  const form = new FormData()
  form.set('city', 'Toronto')
  form.set('latitude', '')
  form.set('longitude', '')
  assert.throws(() => profileLocationFromForm(form), /Choose a city or use your current location/)
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
