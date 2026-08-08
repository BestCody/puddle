import { test, expect } from '@playwright/test'
import {
  admin,
  completeProfileDirect,
  createConfirmedUser,
  poll,
  signInThroughUi
} from './support.mjs'
import { fixturePlaceBySourceId } from './r2-fixture-data.mjs'
import { ensureRelationalFixturePlaces } from './relational-fixture.mjs'

async function createSwiper(displayName) {
  const account = await createConfirmedUser({ displayName })
  await completeProfileDirect(account.user.id, {
    interests: ['cafe', 'gallery', 'restaurant', 'museum', 'park', 'scenic_spot', 'activity_venue'],
    search_radius_km: 25,
    profile_visibility: 'public'
  })
  return account
}

async function openFilteredDeck(page, account, query) {
  await signInThroughUi(page, account.email, account.password, '/discover')
  await expect(page).toHaveURL(/\/discover$/)
  await page.goto(`/discover?q=${encodeURIComponent(query)}`)
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

  await openFilteredDeck(page, account, 'E2E Pass')

  const title = await page.locator('.minimal-swipe-card h1').innerText()
  expect(places.map((place) => place.name)).toContain(title)
  await page.waitForTimeout(300)
  expect(staticRequests).toEqual([])
})

test('passing and undoing works on the relational Supabase deck', async ({ page }) => {
  const places = [fixturePlaceBySourceId('e2e-pass-alpha'), fixturePlaceBySourceId('e2e-pass-beta')]
  await ensureRelationalFixturePlaces(places)
  const account = await createSwiper('Relational Pass Swiper')
  await openFilteredDeck(page, account, 'E2E Pass')

  const heading = page.locator('.minimal-swipe-card h1')
  const firstTitle = await heading.innerText()
  const second = places.find((place) => place.name !== firstTitle)
  expect(second).toBeTruthy()

  await page.getByRole('button', { name: 'Pass' }).click()
  await expect(heading).toHaveText(second.name)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(heading).toHaveText(firstTitle)
})

test('account preference changes persist for relational discovery', async ({ page }) => {
  const account = await createSwiper('Preference Swiper')
  await signInThroughUi(page, account.email, account.password, '/account')
  await expect(page.getByRole('heading', { name: /Account settings/i })).toBeVisible()
  await page.getByLabel('Coffee shops').uncheck()
  await page.getByLabel('Galleries').uncheck()
  await page.getByLabel('Scenic spots').uncheck()
  await page.getByLabel('Restaurants').check()
  await page.getByLabel('Parks & gardens').check()
  await page.getByLabel('Activity dates').check()
  await page.getByRole('button', { name: /Save profile and date preferences/i }).click()
  await expect(page).toHaveURL(/\/account\?success=/)

  const profile = await poll(async () => {
    const result = await admin.from('profiles').select('interests').eq('id', account.user.id).single()
    if (result.error) throw result.error
    return result.data?.interests?.includes('activity_venue') ? result.data : null
  })
  expect(profile.interests).toEqual(expect.arrayContaining(['restaurant', 'park', 'activity_venue']))
})
