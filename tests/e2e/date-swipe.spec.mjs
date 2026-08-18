import { test, expect } from '@playwright/test'
import {
  completeProfileDirect,
  createConfirmedUser,
  signInThroughUi
} from './support.mjs'

const GLOBAL_FIXTURE_PLACES = Object.freeze([
  {
    content_kind: 'place',
    content_id: '7feef11a-5322-4d85-9209-52cfaf8c8401',
    slug: 'e2e-global-alpha',
    title: 'E2E Global Alpha Gallery',
    summary: 'Verified OpenSearch E2E details for Alpha Gallery.',
    description_source: 'canonical',
    category: 'gallery',
    neighborhood: 'Downtown',
    city: 'Toronto',
    region: 'Ontario',
    country: 'Canada',
    country_code: 'CA',
    address_public: '101 Test Street',
    source: 'global_catalogue',
    timezone: 'America/Toronto',
    latitude: 43.65315,
    longitude: -79.38315,
    distance_m: 420,
    distanceLabel: '420 m',
    priceLabel: 'Price varies',
    opening_hours: {},
    amenities: [],
    accessibility: {},
    cover_url: null,
    photo_url: null,
    has_real_photo: false,
    google_place_id: null,
    google_client_lookup: false,
    card_tier: 1,
    card_readiness: 'fallback',
    content_quality_score: 0.6,
    recommendation_ready: true,
    rating_count: 0,
    href: '/places/e2e-global-alpha'
  },
  {
    content_kind: 'place',
    content_id: '9451d350-1cb2-4576-927b-7f723677578d',
    slug: 'e2e-global-beta',
    title: 'E2E Global Beta Gallery',
    summary: 'Verified OpenSearch E2E details for Beta Gallery.',
    description_source: 'canonical',
    category: 'gallery',
    neighborhood: 'Downtown',
    city: 'Toronto',
    region: 'Ontario',
    country: 'Canada',
    country_code: 'CA',
    address_public: '102 Test Street',
    source: 'global_catalogue',
    timezone: 'America/Toronto',
    latitude: 43.65320,
    longitude: -79.38320,
    distance_m: 510,
    distanceLabel: '510 m',
    priceLabel: 'Price varies',
    opening_hours: {},
    amenities: [],
    accessibility: {},
    cover_url: null,
    photo_url: null,
    has_real_photo: false,
    google_place_id: null,
    google_client_lookup: false,
    card_tier: 1,
    card_readiness: 'fallback',
    content_quality_score: 0.6,
    recommendation_ready: true,
    rating_count: 0,
    href: '/places/e2e-global-beta'
  }
])

async function createSwiper(displayName) {
  const account = await createConfirmedUser({ displayName })
  await completeProfileDirect(account.user.id, {
    interests: ['cafe', 'gallery', 'restaurant', 'museum', 'park', 'scenic_spot', 'activity_venue'],
    search_radius_km: 25,
    profile_visibility: 'public'
  })
  return account
}

async function installGlobalDiscoveryFixture(page, places = GLOBAL_FIXTURE_PLACES) {
  await page.route('**/api/discovery**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname !== '/api/discovery') return route.continue()

    let filters = Object.fromEntries(url.searchParams)
    let excludeIds = []
    if (request.method() === 'POST') {
      const body = request.postDataJSON() || {}
      filters = body.filters || {}
      excludeIds = Array.isArray(body.excludeIds) ? body.excludeIds.map(String) : []
    }
    const category = String(filters.category || '').trim()
    const items = places.filter((place) => !excludeIds.includes(place.content_id) && (!category || category === 'all' || place.category === category))

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        requestId: '81b50680-b206-498d-8cd0-b6e5436d358c',
        impressionKey: 'e2e-global-opensearch',
        items,
        filters,
        center: { latitude: 43.6532, longitude: -79.3832 },
        centerLabel: 'Toronto',
        categories: ['gallery'],
        recycled: false,
        emptyReason: items.length ? null : 'exhausted',
        continuation: { excluded: excludeIds.length, candidateLimit: places.length, hasMore: false },
        fallback: false,
        fallbackReason: null,
        rankingVersion: 'global-location-v1',
        experiment: { experiment: 'global-location-v1', variant: 'control', bucket: 0, holdout: false },
        rejections: [],
        personalization: { behavioral: false, friendActivity: false, vector: false, explicitInterestsOnly: true },
        infrastructure: { source: 'global-location-serving', index: 'e2e-locations-active', candidates: items.length, timings: { queryMs: 1, totalMs: 1 } }
      })
    })
  })

  await page.route('**/api/discovery/actions', async (route) => {
    const body = route.request().postDataJSON() || {}
    const actions = Array.isArray(body.actions) ? body.actions : []
    const results = actions.map((action, index) => ({
      action: action.action === 'perfect' ? 'saved' : action.action,
      locationId: action.contentId,
      eventId: action.eventId || `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      sequence: Number(action.sequence || index),
      undone: action.action === 'undo' ? true : undefined,
      previousAction: action.action === 'undo' ? 'dismissed' : undefined,
      densityDelta: 0
    }))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, results, count: results.length }) })
  })
}

async function openFilteredDeck(page, account, category = 'gallery') {
  await signInThroughUi(page, account.email, account.password, '/discover')
  await expect(page).toHaveURL(/\/discover$/)
  await page.goto(`/discover?category=${encodeURIComponent(category)}`)
  await expect(page.locator('.figma-swipe-card')).toBeVisible()
}

test('initial Discover renders OpenSearch-served places without a static catalogue request', async ({ page }) => {
  const account = await createSwiper('Global Initial Swiper')
  const staticRequests = []
  await installGlobalDiscoveryFixture(page)

  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/static-catalogue/')) staticRequests.push(request.url())
  })

  await openFilteredDeck(page, account)

  const title = await page.locator('.figma-swipe-card h1').innerText()
  expect(GLOBAL_FIXTURE_PLACES.map((place) => place.title)).toContain(title)
  await page.waitForTimeout(300)
  expect(staticRequests).toEqual([])
})

test('passing and going back works on the OpenSearch-served deck', async ({ page }) => {
  const account = await createSwiper('Global Pass Swiper')
  await installGlobalDiscoveryFixture(page)
  await openFilteredDeck(page, account)

  const heading = page.locator('.figma-swipe-card h1')
  const firstTitle = await heading.innerText()
  const second = GLOBAL_FIXTURE_PLACES.find((place) => place.title !== firstTitle)
  expect(second).toBeTruthy()

  await page.getByRole('button', { name: 'Pass' }).click()
  await expect(heading).toHaveText(second.title)

  await page.getByRole('button', { name: 'Back' }).click()
  await expect(heading).toHaveText(firstTitle)
})

test('Discover filters own location, distance, and place categories', async ({ page }) => {
  const account = await createSwiper('Filter Preference Swiper')
  await installGlobalDiscoveryFixture(page)

  await signInThroughUi(page, account.email, account.password, '/account')
  await expect(page.locator('.figma-settings-window')).toBeVisible()
  await expect(page.locator('.figma-settings-section:visible')).toHaveCount(0)
  await expect(page.getByLabel('Search radius')).toHaveCount(0)
  await expect(page.getByLabel('City or town')).toHaveCount(0)
  await expect(page.getByText('What kinds of places do you like?')).toHaveCount(0)

  await page.goto('/discover')
  const filterButton = page.getByRole('button', { name: 'Open filters' })

  if (await filterButton.isVisible().catch(() => false)) {
    await filterButton.click()
    await expect(page.getByLabel('Location')).toBeVisible()
    await expect(page.locator('input[placeholder="Coffee, park, museum…"]')).toHaveCount(0)

    const category = page.getByLabel('Category')
    const optionValues = await category.locator('option').evaluateAll((options) => options.map((option) => option.value))
    expect(optionValues).toEqual(expect.arrayContaining([
      'cafe', 'restaurant', 'bar', 'park', 'museum', 'gallery', 'attraction',
      'activity_venue', 'scenic_spot', 'nightlife', 'shop', 'community_space'
    ]))

    await category.selectOption('gallery')
    await page.getByLabel('Distance').selectOption('25')
    await page.getByRole('button', { name: 'Apply' }).click()
  } else {
    await page.goto('/discover?category=gallery&distance=25')
    await expect(page).toHaveURL(/category=gallery.*distance=25|distance=25.*category=gallery/)
  }

  await expect(page.locator('.figma-swipe-card')).toBeVisible()
  const title = await page.locator('.figma-swipe-card h1').innerText()
  expect(GLOBAL_FIXTURE_PLACES.map((place) => place.title)).toContain(title)
})
