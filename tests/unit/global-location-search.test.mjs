import test from 'node:test'
import assert from 'node:assert/strict'
import {
  globalLocationSearchConfig,
  isGlobalLocationSearchConfigured,
  normalizeGlobalLocationViewport,
  searchGlobalLocations,
  viewportLocationLimit
} from '../../lib/app/global-location-search.js'

const objectEnv = {
  OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:8333',
  OBJECT_STORAGE_REGION: 'us-east-1',
  OBJECT_STORAGE_BUCKET: 'puddle-assets',
  OBJECT_STORAGE_ACCESS_KEY_ID: 'key-id',
  OBJECT_STORAGE_SECRET_ACCESS_KEY: 'application-key',
  NEXT_PUBLIC_SUPABASE_URL: '',
  SUPABASE_SECRET_KEY: ''
}

test('global location serving requires the object store', () => {
  const config = globalLocationSearchConfig(objectEnv)
  assert.equal(config.backend, 'object-store')
  assert.equal(config.index, 'active')
  assert.equal(isGlobalLocationSearchConfigured(objectEnv), true)
  assert.equal(isGlobalLocationSearchConfigured({ ...objectEnv, OBJECT_STORAGE_SECRET_ACCESS_KEY: '' }), false)
})

test('serving fails closed when object storage is unconfigured', async () => {
  await assert.rejects(
    () => searchGlobalLocations(
      { latitude: 43.65, longitude: -79.39, distanceKm: 25, candidateLimit: 20 },
      { env: { ...objectEnv, OBJECT_STORAGE_SECRET_ACCESS_KEY: '', SUPABASE_SECRET_KEY: '' } }
    ),
    /not configured/
  )
})

test('viewport normalization stays bounded', () => {
  const viewport = normalizeGlobalLocationViewport({
    north: 43.8, south: 43.55, west: -79.65, east: -79.1, zoom: 13
  })
  assert.equal(viewport.zoom, 13)
  assert.equal(viewportLocationLimit(13), 150)
})
