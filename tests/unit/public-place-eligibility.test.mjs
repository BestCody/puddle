import test from 'node:test'
import assert from 'node:assert/strict'
import { isPublicLeisurePlace } from '../../lib/app/public-place-eligibility.js'

test('public recommendations reject non-leisure services despite stale imported categories', () => {
  for (const name of ['Toronto Fire Station 122', 'Metroplace Computers', 'Local SEO Canada', 'Digital Marketing Agency']) {
    assert.equal(isPublicLeisurePlace({ name, category: 'cafe', summary: 'A cafe in Toronto.' }), false)
  }
  assert.equal(isPublicLeisurePlace({ name: 'Downtown', source_category: 'computer_store', category: 'cafe' }), false)
})
test('eligibility does not exclude real leisure venues or rely on city/IDs', () => {
  for (const name of ['Fire Station Brewery', 'Computer Museum', 'Internet Café', 'Second Cup Café', 'Bar None', 'Riverside Park']) assert.equal(isPublicLeisurePlace({ name }), true)
})
