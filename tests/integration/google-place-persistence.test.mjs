import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Google Place ID matching runs progressively and persists only verified mappings', async () => {
  const workflow = await read('.github/workflows/google-place-match.yml')
  const matcher = await read('scripts/match-google-places.mjs')

  assert.match(workflow, /schedule:/)
  assert.match(workflow, /cron:/)
  assert.match(workflow, /--limit=250 --apply/)
  assert.match(workflow, /GOOGLE_PLACES_API_KEY/)
  assert.doesNotMatch(workflow, /B2_/)

  assert.match(matcher, /scoreGooglePlaceMatch/)
  assert.match(matcher, /best\.match\.score < MIN_SCORE/)
  assert.match(matcher, /from\('location_google_places'\)\.upsert/)
  assert.match(matcher, /status: 'verified'/)
  assert.doesNotMatch(matcher, /static-media-overlay|syncStaticMediaOverlayForLocations/)
})

test('Discover prefers a stored Google Place ID and only uses coordinates when no ID exists', async () => {
  const discovery = await read('lib/app/discovery-relational.js')

  assert.match(discovery, /const googlePlaceId = row\.google_place_id \|\| null/)
  assert.match(discovery, /const googleClientLookup = !photoUrl && !googlePlaceId/)
  assert.match(discovery, /google_photo_proxy_url: googlePlaceId \?/)
})
