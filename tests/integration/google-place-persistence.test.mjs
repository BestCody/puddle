import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Google Place ID matching exhausts free SKU allowances before deferring paid verification', async () => {
  const workflow = await read('.github/workflows/google-place-match.yml')
  const matcher = await read('scripts/match-google-places.mjs')
  const migration = await read('supabase/migrations/10052_google_places_free_quota_matching.sql')

  assert.match(workflow, /cron: '29 \* \* \* \*'/)
  assert.match(workflow, /--limit=2000 --apply/)
  assert.match(workflow, /GOOGLE_PLACE_MATCH_DELAY_MS: '100'/)
  assert.match(workflow, /GOOGLE_PLACE_MATCH_MAX_DETAILS_CANDIDATES: '5'/)
  assert.match(workflow, /GOOGLE_PLACES_API_KEY/)
  assert.doesNotMatch(workflow, /B2_/)

  assert.match(matcher, /'X-Goog-FieldMask': 'places\.id,places\.displayName,places\.formattedAddress,places\.location'/)
  assert.match(matcher, /'X-Goog-FieldMask': 'places\.id'/)
  assert.match(matcher, /'id,displayName,formattedAddress,location'/)
  assert.match(matcher, /'id,formattedAddress,location'/)
  assert.match(matcher, /reserve_google_places_free_sku_v1/)
  assert.match(matcher, /release_google_places_free_sku_v1/)
  assert.match(matcher, /scoreGooglePlaceEssentialsMatch/)
  assert.match(matcher, /status: 'quota_deferred'/)
  assert.match(matcher, /from\('location_google_places'\)\.upsert/)
  assert.match(matcher, /status: 'verified'/)
  assert.doesNotMatch(matcher, /static-media-overlay|syncStaticMediaOverlayForLocations/)

  assert.match(migration, /'text_search_pro' then 5000/)
  assert.match(migration, /'place_details_pro' then 5000/)
  assert.match(migration, /'place_details_essentials' then 10000/)
  assert.match(migration, /claim_google_place_candidates_v2/)
  assert.match(migration, /location\.address_public/)
  assert.match(migration, /least\(coalesce\(batch_size,100\),5000\)/)
  assert.match(migration, /status in \('no_match','failed','quota_deferred'\)/)
  assert.match(migration, /grant execute on function public\.reserve_google_places_free_sku_v1\(text\) to service_role/)
})

test('Discover prefers a stored Google Place ID and only uses coordinates when no ID exists', async () => {
  const discovery = await read('lib/app/discovery-relational.js')

  assert.match(discovery, /const googlePlaceId = row\.google_place_id \|\| null/)
  assert.match(discovery, /const googleClientLookup = !photoUrl && !googlePlaceId/)
  assert.match(discovery, /google_photo_proxy_url: googlePlaceId \?/)
})
