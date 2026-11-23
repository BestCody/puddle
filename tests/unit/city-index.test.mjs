import assert from 'node:assert/strict'
import test from 'node:test'
import { foldPlaceName, geocodeAddress, reverseGeocodeLocation, searchCities } from '../../lib/app/geocoding.js'

const labels = (results) => results.map((result) => result.label)

test('city search returns the response shape the location pickers read', () => {
  assert.deepEqual(searchCities('Tokyo', { limit: 1 })[0], {
    providerId: 'geonames:1850147',
    city: 'Tokyo',
    region: 'Tokyo',
    country: 'Japan',
    countryCode: 'JP',
    latitude: 35.6895,
    longitude: 139.6917,
    timezone: 'Asia/Tokyo',
    label: 'Tokyo, Japan',
    confidence: null,
    resultType: 'city'
  })
})

test('city search ignores case and accents and ranks exact names before larger partial matches', () => {
  assert.equal(foldPlaceName('São  Paulo!'), 'sao paulo')
  assert.equal(searchCities('zurich')[0].label, 'Zürich, Zurich, Switzerland')
  assert.equal(searchCities('YORK')[0].label, 'York, England, United Kingdom')
  assert.equal(searchCities('francisco')[0].label, 'San Francisco, California, United States')
})

test('city search narrows by region or country, including postal abbreviations', () => {
  assert.deepEqual(labels(searchCities('Paris, Texas')), ['Paris, Texas, United States'])
  assert.equal(searchCities('Portland, OR')[0].label, 'Portland, Oregon, United States')
  assert.equal(searchCities('Oakville, ON')[0].label, 'Oakville, Ontario, Canada')
  assert.equal(searchCities('Oakville, United States')[0].countryCode, 'US')
})

test('city search bounds its input and output', () => {
  assert.deepEqual(searchCities('a'), [])
  assert.deepEqual(searchCities('   '), [])
  assert.equal(searchCities('san', { limit: 3 }).length, 3)
  assert.equal(searchCities('san', { limit: 500 }).length, 10)
  assert.deepEqual(searchCities('qqqqzzzz'), [])
})

test('reverse lookup names the surrounding city and keeps the exact coordinates', () => {
  const result = reverseGeocodeLocation(43.45, -79.69)
  assert.equal(result.label, 'Oakville, Ontario, Canada')
  assert.equal(result.latitude, 43.45)
  assert.equal(result.longitude, -79.69)
  assert.equal(result.timezone, 'America/Toronto')
})

test('reverse lookup prefers a big city at its centre but keeps neighbouring cities', () => {
  assert.equal(reverseGeocodeLocation(35.68, 139.76).city, 'Tokyo')
  assert.equal(reverseGeocodeLocation(48.8566, 2.3522).city, 'Paris')
  assert.equal(reverseGeocodeLocation(48.8638, 2.4485).city, 'Montreuil')
  assert.equal(reverseGeocodeLocation(42.3736, -71.1097).city, 'Cambridge')
})

test('reverse lookup rejects invalid or unpopulated locations', () => {
  assert.throws(() => reverseGeocodeLocation(91, 0), /invalid/)
  assert.throws(() => reverseGeocodeLocation('north', 0), /invalid/)
  assert.throws(() => reverseGeocodeLocation(30, -40), /could not identify/)
})

test('address lookup resolves street addresses to their city', () => {
  assert.equal(geocodeAddress('350 5th Ave, New York, NY 10118').result.city, 'New York City')
  assert.equal(geocodeAddress('123 Lakeshore Rd E, Oakville, ON L6J 1H9, Canada').result.label, 'Oakville, Ontario, Canada')
  assert.equal(geocodeAddress('Musée du Louvre, 75001 Paris, France').result.city, 'Paris')
  assert.equal(geocodeAddress('Main Street 5, Springfield, IL').result.region, 'Illinois')
  assert.equal(geocodeAddress('Toronto').configured, true)
})

test('address lookup reports no match or a too-short address', () => {
  assert.equal(geocodeAddress('1234 5678 90').result, null)
  assert.throws(() => geocodeAddress('ab'), /more complete address/)
})
