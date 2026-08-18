import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('global discovery failures never fail over to Supabase/Postgres', async () => {
  const [discoverySource, publicLocationSource, envExample] = await Promise.all([
    read('lib/app/discovery.js'),
    read('lib/app/public-location-cache.js'),
    read('.env.example')
  ])

  for (const forbidden of [
    'GLOBAL_LOCATION_FALLBACK_TO_SUPABASE',
    'GLOBAL_LOCATION_EMERGENCY_RELATIONAL_FALLBACK',
    'GLOBAL_LOCATION_RELATIONAL_FALLBACK_MIN_INTERVAL_MS',
    'getRelationalDiscoveryFeed',
    'discovery-relational'
  ]) {
    assert.doesNotMatch(discoverySource, new RegExp(forbidden))
  }

  assert.doesNotMatch(publicLocationSource, /from\('locations'\)/)
  assert.doesNotMatch(publicLocationSource, /GLOBAL_LOCATION_FALLBACK_TO_SUPABASE/)
  assert.doesNotMatch(envExample, /GLOBAL_LOCATION_FALLBACK_TO_SUPABASE/)

  assert.match(discoverySource, /getGlobalDiscoveryFeed/)
  assert.match(discoverySource, /global-location-stale-cache/)
  assert.match(discoverySource, /global-location-degraded/)
  assert.match(discoverySource, /return emptyDegradedFeed\(session, filters, reason\)/)
})
