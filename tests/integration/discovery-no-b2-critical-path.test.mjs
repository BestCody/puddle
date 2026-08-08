import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Discover serves cards from Supabase without a B2 catalogue dependency', async () => {
  const route = await read('app/api/discovery/route.js')
  const feed = await read('lib/app/discovery-relational-fallback.js')
  const analytics = await read('lib/app/discovery-analytics.js')

  assert.match(route, /getRelationalDiscoveryFeed/)
  assert.match(route, /recordSampledDiscoveryAnalytics/)
  assert.doesNotMatch(route, /getInfrastructureDiscoveryFeedV2/)
  assert.doesNotMatch(route, /authorizeDiscoveryFeedB2Assets/)
  assert.doesNotMatch(route, /b2-feed-assets/)
  assert.doesNotMatch(route, /discovery-infrastructure-v2/)

  assert.match(feed, /catalogue: 'supabase-primary'/)
  assert.match(feed, /fallback: false/)
  assert.match(feed, /candidateSources: \['supabase_relational'\]/)
  assert.doesNotMatch(feed, /fetchPrivateB2Asset/)
  assert.doesNotMatch(feed, /fetchCachedNearbyStaticPlaces/)
  assert.doesNotMatch(feed, /staticCatalogueBaseUrl/)

  assert.doesNotMatch(analytics, /discovery-infrastructure-v2/)
  assert.doesNotMatch(analytics, /b2-/)
})
