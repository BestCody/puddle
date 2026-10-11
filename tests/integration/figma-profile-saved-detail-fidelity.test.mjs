import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Profile save count uses the full saved-location relation, not the preview page', async () => {
  const page = await read('app/(product)/profile/page.js')
  const counts = page.slice(page.indexOf('figma-profile-counts'), page.indexOf('figma-profile-chips'))

  assert.match(page, /async function readSavedLocationCount\(supabase, profileId\)/)
  assert.match(page, /\.select\('location_id', \{ count: 'exact', head: true \}\)/)
  assert.match(page, /\.eq\('state', 'saved'\)/)
  assert.match(page, /\.not\('location_id', 'is', null\)/)
  assert.match(counts, /savedLocationCount/)
  assert.doesNotMatch(counts, /visibleSaves\.length/)
})

test('Saved detail media and secondary reads expose resilient user-facing states', async () => {
  const [page, reviews, similar, photoFrame, morph] = await Promise.all([
    read('app/(product)/plans/[slug]/page.js'),
    read('app/(product)/plans/[slug]/detail-reviews.js'),
    read('app/(product)/plans/[slug]/similar-places.js'),
    read('components/photo-frame.js'),
    read('components/saved-location-morph-bridge.js')
  ])

  assert.match(page, /<PhotoFrame[\s\S]*detailHero/)
  assert.match(page, /fetchPriority="high"/)
  assert.match(reviews, /setRetry/)
  assert.match(reviews, /Loading reviews…/)
  assert.match(reviews, /Reviews could not be loaded\./)
  assert.match(reviews, /Try again/)
  assert.match(similar, /setRetry/)
  assert.match(similar, /Loading similar places…/)
  assert.match(similar, /Recommendations could not be loaded\./)
  assert.doesNotMatch(similar, /error\?\.message/)
  assert.match(similar, /PhotoFrame as="span"/)
  assert.match(similar, /content_kind !== 'event'/)
  assert.match(similar, /`\/places\/\$\{encodeURIComponent\(item\.slug\)\}`/)
  assert.match(photoFrame, /onError=\{\(\) => setFailed\(true\)\}/)
  assert.match(photoFrame, /onLoad=\{\(\) => setLoaded\(true\)\}/)
  assert.match(photoFrame, /data-photo-state=\{state\}/)
  assert.match(photoFrame, /Photo unavailable/)
  assert.match(morph, /className=[^>]*"saved-inline-detail-hero"[^>]* data-inline-morph-photo/)
  assert.match(morph, /saved-inline-detail-similar-photo/)
  assert.match(morph, /content_kind !== 'event'/)
  assert.match(morph, /`\/places\/\$\{encodeURIComponent\(item\.slug\)\}`/)
  assert.match(morph, /detailError/)
  assert.match(morph, /Saved details could not be loaded\./)
  assert.match(morph, /onRetry=\{retryDetail\}/)
})
