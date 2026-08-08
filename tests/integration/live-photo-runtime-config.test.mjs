import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('production media route uses explicit runtime environment references for Google matching', async () => {
  const runtimeConfig = await read('lib/app/static-media-runtime-config.js')
  const route = await read('app/api/static-catalogue/media/[id]/route.js')

  for (const variable of [
    'STATIC_MEDIA_RESOLUTION_ENABLED',
    'NEXT_PUBLIC_STATIC_MEDIA_RESOLUTION_ENABLED',
    'STATIC_MEDIA_GOOGLE_DAILY_LIMIT',
    'STATIC_MEDIA_GOOGLE_MONTHLY_LIMIT',
    'GOOGLE_PLACE_MATCH_MIN_SCORE',
    'GOOGLE_PLACE_MATCH_TIMEOUT_MS',
    'STATIC_MEDIA_B2_BASELINE_BYTES',
    'B2_PHOTO_START_MAX_BYTES',
    'STATIC_MEDIA_PHOTO_RESERVATION_BYTES',
    'SUPABASE_LAUNCH_MAX_BYTES',
    'GOOGLE_PLACES_API_KEY'
  ]) {
    assert.match(runtimeConfig, new RegExp(`process\\.env\\.${variable}`))
  }

  assert.match(route, /const config = staticMediaRuntimeConfiguration\(\)/)
  assert.match(route, /resolveStaticCatalogueMedia\(reference, \{ mode, config \}\)/)
  assert.doesNotMatch(route, /staticMediaResolverConfiguration\(\)/)
})
