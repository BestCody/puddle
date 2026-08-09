import { test, expect } from '@playwright/test'
import {
  completeProfileDirect,
  createConfirmedUser,
  signInThroughUi
} from './support.mjs'
import { ensureRelationalFixturePlaces, fixturePlaceBySourceId } from './relational-fixture.mjs'

async function createSwiper(displayName) {
  const account = await createConfirmedUser({ displayName })
  await completeProfileDirect(account.user.id, {
    interests: ['cafe', 'gallery', 'restaurant', 'museum', 'park', 'scenic_spot', 'activity_venue'],
    search_radius_km: 25,
    profile_visibility: 'public'
  })
  return account
}

async function openFilteredDeck(page, account, category = 'gallery') {
  await signInThroughUi(page, account.email, account.password, '/discover')
  await expect(page).toHaveURL(/\/discover$/)
  await page.goto(`/discover?category=${encodeURIComponent(category)}`)
  await expect(page.locator('.minimal-swipe-card')).toBeVisible()
}

test('initial Discover renders relational Supabase places without a static catalogue request', async ({ page }) => {
  const places = [fixturePlaceBySourceId('e2e-pass-alpha'), fixturePlaceBySourceId('e2e-pass-beta')]
  await ensureRelationalFixturePlaces(places)
  const account = await createSwiper('Relational Initial Swiper')
  const staticRequests = []

  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/static-catalogue/')) staticRequests.push(request.url())
  })

  await openFilteredDeck(page, account)

  const title = await page.locator('.minimal-swipe-card h1').innerText()
  expect(places.map((place) => place.name)).toContain(title)
  await page.waitForTimeout(300)
  expect(staticRequests).toEqual([])
})

test('passing and undoing works on the relational Supabase deck', async ({ page }) => {
  const places = [fixturePlaceBySourceId('e2e-pass-alpha'), fixturePlaceBySourceId('e2e-pass-beta')]
  await ensureRelationalFixturePlaces(places)
  const account = await createSwiper('Relational Pass Swiper')
  await openFilteredDeck(page, account)

  const heading = page.locator('.minimal-swipe-card h1')
  const firstTitle = await heading.innerText()
  const second = places.find((place) => place.name !== firstTitle)
  expect(second).toBeTruthy()

  await page.getByRole('button', { name: 'Pass' }).click()
  await expect(heading).toHaveText(second.name)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(heading).toHaveText(firstTitle)
})

test('Discover filters own location, distance, and place categories', async ({ page }) => {
  const places = [fixturePlaceBySourceId('e2e-pass-alpha'), fixturePlaceBySourceId('e2e-pass-beta')]
  await ensureRelationalFixturePlaces(places)
  const account = await createSwiper('Filter Preference Swiper')

  await signInThroughUi(page, account.email, account.password, '/account')
  await expect(page.getByRole('heading', { name: /Account settings/i })).toBeVisible()
  await expect(page.getByLabel('Search radius')).toHaveCount(0)
  await expect(page.getByLabel('City or town')).toHaveCount(0)
  await expect(page.getByText('What kinds of places do you like?')).toHaveCount(0)

  await page.goto('/discover')
  await page.getByRole('button', { name: 'Open filters' }).click()
  await expect(page.getByLabel('Location')).toBeVisible()
  await expect(page.locator('input[placeholder="Coffee, park, museum…"]')).toHaveCount(0)

  const category = page.getByLabel('Category')
  const optionValues = await category.locator('option').evaluateAll((options) => options.map((option) => option.value))
  expect(optionValues).toEqual(expect.arrayContaining([
    'cafe',
    'restaurant',
    'bar',
    'park',
    'museum',
    'gallery',
    'attraction',
    'activity_venue',
    'scenic_spot',
    'nightlife',
    'shop',
    'community_space'
  ]))

  await category.selectOption('gallery')
  await page.getByLabel('Distance').selectOption('25')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.locator('.minimal-swipe-card')).toBeVisible()
  const title = await page.locator('.minimal-swipe-card h1').innerText()
  expect(places.map((place) => place.name)).toContain(title)
})
