import { test, expect } from '@playwright/test'
import { staticCatalogueMaterializationItem } from '../../lib/app/static-catalogue-bulk-materialization.js'
import { admin, completeProfileDirect, createConfirmedUser, signInThroughUi } from './support.mjs'
import {
  R2_FIXTURE_BASE_URL,
  R2_FIXTURE_IDS,
  R2_FIXTURE_RELEASE,
  R2_RAPID_SWIPE_PLACES
} from './r2-fixture-data.mjs'

async function ensureRapidSwipeCatalogueInSupabase() {
  const items = R2_RAPID_SWIPE_PLACES.map((place) => staticCatalogueMaterializationItem(place, {
    release: R2_FIXTURE_RELEASE,
    detail: place,
    provenance: place
  })).filter(Boolean)
  const { data, error } = await admin.rpc('materialize_static_catalogue_locations_v2', { items })
  if (error) throw error
  if (!Array.isArray(data) || data.length !== items.length) {
    throw new Error('Supabase did not materialize the complete rapid-swipe fixture catalogue.')
  }

  const { data: mediaObject, error: mediaError } = await admin
    .from('media_objects')
    .upsert({
      storage_backend: 'remote',
      storage_key: 'e2e/rapid-swipe-01',
      public_url: `${R2_FIXTURE_BASE_URL}/photos/e2e-media.png`,
      content_hash: 'e'.repeat(64),
      byte_size: 1024,
      width: 640,
      height: 480
    }, { onConflict: 'storage_backend,storage_key' })
    .select('id')
    .single()
  if (mediaError) throw mediaError

  const { error: photoError } = await admin
    .from('location_photo_sources')
    .upsert({
      location_id: R2_FIXTURE_IDS['e2e-rapid-01'],
      source: 'licensed_public',
      provider: 'wikimedia-commons',
      external_photo_id: 'e2e-rapid-01-photo',
      remote_url: 'https://example.com/e2e-media.png',
      attribution_text: 'E2E Fixture · CC0',
      attribution_url: 'https://example.com/e2e-photo-attribution',
      license_code: 'CC0-1.0',
      width: 640,
      height: 480,
      is_primary: true,
      sort_order: 0,
      status: 'approved',
      is_ai_generated: false,
      storage_backend: 'remote',
      media_object_id: mediaObject.id
    }, { onConflict: 'location_id,provider,external_photo_id' })
  if (photoError) throw photoError
}

async function createRapidSwiper() {
  await ensureRapidSwipeCatalogueInSupabase()
  const account = await createConfirmedUser({ displayName: 'Rapid Media Swiper' })
  await completeProfileDirect(account.user.id, {
    interests: ['cafe'],
    search_radius_km: 25,
    profile_visibility: 'public'
  })
  return account
}

async function stubStaticMedia(page, delay = 30) {
  await page.route('**/api/static-catalogue/media/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delay))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        state: 'no_match',
        photo_url: null,
        photo_provider: null,
        photo_attribution: null,
        photo_attribution_url: null,
        photo_license: null,
        has_real_photo: false,
        google_place_id: null,
        google_match_score: null
      })
    })
  })
}

test('approved relational media renders directly without static-media resolution', async ({ page }) => {
  const account = await createRapidSwiper()
  const staticMediaRequests = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/static-catalogue/media/')) staticMediaRequests.push(request.url())
  })

  await signInThroughUi(page, account.email, account.password, '/discover')
  await page.goto('/discover?q=E2E%20Rapid%20Swipe%2001')

  const heading = page.locator('.minimal-swipe-card h1')
  const photo = page.locator('.minimal-swipe-photo')
  await expect(heading).toHaveText('E2E Rapid Swipe 01')
  expect(String(await photo.getAttribute('style'))).toContain('e2e-media.png')
  await page.waitForTimeout(300)
  expect(staticMediaRequests).toEqual([])
})

test('discovery refills in the background and keeps swiping past the twelve-card boundary', async ({ page }) => {
  const account = await createRapidSwiper()
  await stubStaticMedia(page)

  let continuationRequests = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/discovery') continuationRequests += 1
  })

  await signInThroughUi(page, account.email, account.password, '/discover')
  await page.goto('/discover?q=E2E%20Rapid%20Swipe')

  const heading = page.locator('.minimal-swipe-card h1')
  await expect(heading).toContainText('E2E Rapid Swipe')
  const titles = []

  for (let index = 0; index < 14; index += 1) {
    await expect(heading).toBeVisible()
    const title = await heading.innerText()
    expect(title).toMatch(/^E2E Rapid Swipe \d{2}$/)
    expect(titles).not.toContain(title)
    titles.push(title)
    if (index === 13) break
    await page.getByRole('button', { name: 'Pass' }).click()
    await expect(heading).not.toHaveText(title)
  }

  expect(titles).toHaveLength(14)
  expect(new Set(titles).size).toBe(14)
  expect(continuationRequests).toBeGreaterThan(0)
  await expect(page.getByText('Deck complete', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Swipe again' })).toHaveCount(0)
})
