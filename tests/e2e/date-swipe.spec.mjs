import { test, expect } from '@playwright/test'
import {
  completeProfileDirect,
  createConfirmedUser,
  signInThroughUi
} from './support.mjs'
import { GLOBAL_LOCATION_FIXTURES } from './global-location-fixture.mjs'

const fixtureNames = GLOBAL_LOCATION_FIXTURES.map((place) => place.name)
const galleryFixtureNames = GLOBAL_LOCATION_FIXTURES
  .filter((place) => place.category === 'gallery')
  .map((place) => place.name)

async function createSwiper(displayName) {
  const account = await createConfirmedUser({ displayName })
  await completeProfileDirect(account.user.id, {
    interests: ['cafe', 'gallery', 'restaurant', 'museum', 'park', 'scenic_spot', 'activity_venue'],
    search_radius_km: 25,
    profile_visibility: 'public'
  })
  return account
}

async function openDeck(page, account, query = '') {
  await signInThroughUi(page, account.email, account.password, '/discover')
  await expect(page).toHaveURL(/\/discover$/)
  if (query) await page.goto(`/discover${query}`)
  await expect(page.locator('.figma-swipe-card')).toBeVisible()
}

test('initial Discover renders OpenSearch-served places without a static catalogue request', async ({ page }) => {
  const account = await createSwiper('Global Initial Swiper')
  const staticRequests = []

  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/static-catalogue/')) staticRequests.push(request.url())
  })

  await openDeck(page, account)

  const title = await page.locator('.figma-swipe-card h1').innerText()
  expect(fixtureNames).toContain(title)
  await page.waitForTimeout(300)
  expect(staticRequests).toEqual([])
})

test('passing and undoing works on the OpenSearch-served deck', async ({ page }) => {
  const account = await createSwiper('Global Pass Swiper')
  await openDeck(page, account)

  const heading = page.locator('.figma-swipe-card h1')
  const undo = page.getByRole('button', { name: 'Message', exact: true })
  await expect(undo).toBeDisabled()

  const firstTitle = await heading.innerText()
  expect(fixtureNames).toContain(firstTitle)

  await page.getByRole('button', { name: 'Pass', exact: true }).click()
  await expect(heading).not.toHaveText(firstTitle)
  const secondTitle = await heading.innerText()
  expect(fixtureNames).toContain(secondTitle)
  await expect(undo).toBeEnabled()

  await undo.click()
  await expect(heading).toHaveText(firstTitle)
})

test('Discover filters own location, distance, and place categories', async ({ page }) => {
  const account = await createSwiper('Filter Preference Swiper')

  await signInThroughUi(page, account.email, account.password, '/account')
  await expect(page.locator('.figma-settings-window')).toBeVisible()
  await expect(page.locator('.figma-settings-section:visible')).toHaveCount(7)
  await expect(page.getByLabel('Search radius')).toHaveCount(0)
  await expect(page.getByLabel('City or town')).toHaveCount(0)
  await expect(page.getByText('What kinds of places do you like?')).toHaveCount(0)

  await page.goto('/discover')
  await expect(page.locator('.figma-swipe-card')).toBeVisible()

  const filterButton = page.getByRole('button', { name: 'Open filters' })
  await expect(filterButton).toBeVisible()
  await filterButton.click()
  await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible()
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
  await page.getByRole('button', { name: 'Apply', exact: true }).click()

  await expect(page.getByRole('dialog', { name: 'Filters' })).toHaveCount(0)
  await expect(page.locator('.figma-swipe-card')).toBeVisible()
  const title = await page.locator('.figma-swipe-card h1').innerText()
  expect(galleryFixtureNames).toContain(title)
})
