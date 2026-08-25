import test from 'node:test'
import assert from 'node:assert/strict'
import {
  globalLocationSearchConfig,
  isGlobalLocationSearchConfigured,
  normalizeGlobalLocationViewport,
  searchGlobalLocations,
  viewportLocationLimit
} from '../../lib/app/global-location-search.js'

const b2Env = {
  B2_DATA_APPLICATION_KEY_ID: 'key-id',
  B2_DATA_APPLICATION_KEY: 'application-key',
  B2_DATA_BUCKET_NAME: 'puddle-assets',
  NEXT_PUBLIC_SUPABASE_URL: '',
  SUPABASE_SECRET_KEY: ''
}

test('global location serving is B2-only and reports its configuration', () => {
  const config = globalLocationSearchConfig(b2Env)
  assert.equal(config.backend, 'b2')
  assert.equal(config.index, 'b2-active')
  assert.equal(isGlobalLocationSearchConfigured(b2Env), true)
  assert.equal(isGlobalLocationSearchConfigured({ ...b2Env, B2_DATA_APPLICATION_KEY: '' }), false)
})

test('serving fails closed instead of falling back when B2 is unconfigured', async () => {
  await assert.rejects(
    () => searchGlobalLocations(
      { latitude: 43.65, longitude: -79.39, distanceKm: 25, candidateLimit: 20 },
      { env: { ...b2Env, B2_DATA_APPLICATION_KEY: '', SUPABASE_SECRET_KEY: '' } }
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
