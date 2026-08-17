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

  for (const forbiddenFlag of [
    'GLOBAL_LOCATION_FALLBACK_TO_SUPABASE',
    'GLOBAL_LOCATION_EMERGENCY_RELATIONAL_FALLBACK',
    'GLOBAL_LOCATION_RELATIONAL_FALLBACK_MIN_INTERVAL_MS'
  ]) {
    assert.doesNotMatch(discoverySource, new RegExp(forbiddenFlag))
    assert.doesNotMatch(publicLocationSource, new RegExp(forbiddenFlag))
    assert.doesNotMatch(envExample, new RegExp(forbiddenFlag))
  }

  // Relational discovery remains legal only when the global serving flag is deliberately off.
  assert.match(
    discoverySource,
    /return String\(env\.GLOBAL_LOCATION_SEARCH_ENABLED \|\| ''\)\.toLowerCase\(\) === 'true'/
  )
  assert.doesNotMatch(discoverySource, /isGlobalLocationSearchConfigured/)
  assert.match(
    discoverySource,
    /if \(!useGlobalLocationServing\(\)\) return getRelationalDiscoveryFeed\(session, filters, options\)/
  )
  assert.equal(
    discoverySource.match(/getRelationalDiscoveryFeed\(session, filters, options\)/g)?.length,
    1
  )

  // Public location details follow the same invariant: enabled but misconfigured is an outage,
  // never permission to reach for relational location serving.
  assert.match(publicLocationSource, /const useGlobal = String\(process\.env\.GLOBAL_LOCATION_SEARCH_ENABLED \|\| ''\)\.toLowerCase\(\) === 'true'/)
  assert.doesNotMatch(publicLocationSource, /isGlobalLocationSearchConfigured/)

  assert.match(discoverySource, /global-location-stale-cache/)
  assert.match(discoverySource, /return emptyDegradedFeed\(session, filters, reason\)/)
  assert.match(envExample, /never fail over to Supabase\/Postgres/)
})
