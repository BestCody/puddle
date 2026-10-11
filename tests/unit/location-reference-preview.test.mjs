import assert from 'node:assert/strict'
import test from 'node:test'
import { locationReferenceMetadata, savedLocationOption } from '../../lib/app/location-reference-preview.js'

const hash = 'a'.repeat(64)
const location = { id: 'place', name: 'Park', slug: 'park', category: 'park', city: 'Toronto', latitude: 0, longitude: 0, primary_photo: { content_hash: hash } }

test('referenced-location preview retains real coordinates and only canonical photo identity', () => {
  const metadata = locationReferenceMetadata(location)
  assert.equal(metadata.latitude, 0)
  assert.equal(metadata.longitude, 0)
  assert.equal(metadata.photo_hash, hash)
  assert.deepEqual(savedLocationOption(metadata), {
    id: 'place', name: 'Park', title: 'Park', slug: 'park', category: 'park', city: 'Toronto', latitude: 0, longitude: 0,
    cover_url: `/api/open-photo/${hash}`
  })
})

test('missing or invalid coordinates and photo hashes never become fabricated previews', () => {
  for (const input of [{ latitude: null, longitude: null }, { latitude: 91, longitude: 0 }, { latitude: '', longitude: 0 }]) {
    const metadata = locationReferenceMetadata({ ...location, ...input, primary_photo: { content_hash: 'invalid' } })
    assert.equal(metadata.latitude, null)
    assert.equal(metadata.longitude, null)
    assert.equal(savedLocationOption(metadata).cover_url, null)
  }
})
