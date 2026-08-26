import { test, expect } from '@playwright/test'

async function mockTorontoSearch(page) {
  await page.route('**/api/location/search?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{
          providerId: 'completed-ui-live-smoke-toronto',
          city: 'Toronto',
          region: 'Ontario',
          country: 'Canada',
          countryCode: 'CA',
          latitude: 43.6532,
          longitude: -79.3832,
          timezone: 'America/Toronto',
          label: 'Toronto, Ontario, Canada'
        }]
      })
    })
  })
}

async function createDisposableAccount(page, { displayName, email, password, username }) {
  await mockTorontoSearch(page)
  await page.goto('/signup')
  await page.getByLabel('Display name').fill(displayName)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('checkbox', { name: /confirm the information I/i }).check()
  await page.getByRole('button', { name: 'Create my Puddle →' }).click()
  await page.waitForURL(/\/onboarding(?:\?|$)/, { timeout: 30_000 })

  await page.locator('input[name="username"]').fill(username)
  await page.locator('input[name="birth_date"]').fill('1990-01-01')
  await page.getByLabel('City or town').fill('Toronto')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByRole('option').filter({ hasText: 'Toronto' }).click()
  await page.getByRole('checkbox', { name: 'Coffee shops' }).check()
  await page.getByRole('checkbox', { name: 'Restaurants' }).check()
  await page.getByRole('checkbox', { name: 'Parks & gardens' }).check()
  await page.getByRole('button', { name: 'Build my date deck →' }).click()
  await page.waitForURL(/\/discover(?:\?|$)/, { timeout: 30_000 })
}

async function deleteDisposableAccount(page) {
  try {
    await page.goto('/account', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    if (!/\/account(?:\?|$)/.test(page.url())) return
    const confirmation = page.locator('input[name="confirmation"]')
    if (!(await confirmation.isVisible().catch(() => false))) return
    await confirmation.fill('DELETE')
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/' && url.searchParams.get('account') === 'deleted', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Delete my account' }).click()
    ])
  } catch {
    // Cleanup is best-effort; test assertions remain authoritative.
  }
}

async function ensureSaved(page, slug) {
  await page.goto(`/plans/${slug}`)
  const save = page.getByRole('button', { name: 'Save', exact: true })
  if (await save.isVisible().catch(() => false)) {
    await save.click()
    await expect(page.getByRole('button', { name: 'Unsave', exact: true })).toBeVisible({ timeout: 30_000 })
  }
}

async function submitServerAction(page, buttonName, expectedMessage, detailPath) {
  await Promise.all([
    page.waitForURL((url) => url.searchParams.get('success') === expectedMessage, { timeout: 30_000 }),
    page.getByRole('button', { name: buttonName }).click()
  ])
  await page.goto(detailPath)
}

test('completed UI paths work against production', async ({ page, browser }) => {
  test.setTimeout(240_000)
  const suffix = `${Date.now().toString(36)}${crypto.randomUUID().replaceAll('-', '').slice(0, 7)}`
  const owner = {
    displayName: `Completed UI ${suffix.slice(-5)}`,
    email: `puddle-ui-owner-${suffix}@example.com`,
    password: `UiOwner-${suffix}-A9!`,
    username: `uio_${suffix}`.slice(0, 24)
  }
  const friend = {
    displayName: `UI Friend ${suffix.slice(-5)}`,
    email: `puddle-ui-friend-${suffix}@example.com`,
    password: `UiFriend-${suffix}-B8!`,
    username: `uif_${suffix}`.slice(0, 24)
  }

  let ownerCreated = false
  let friendCreated = false
  let friendContext = null
  let friendPage = null

  try {
    await createDisposableAccount(page, owner)
    ownerCreated = true

    friendContext = await browser.newContext({ baseURL: process.env.LIVE_BASE_URL || 'https://puddle.you' })
    friendPage = await friendContext.newPage()
    await createDisposableAccount(friendPage, friend)
    friendCreated = true

    for (const slug of ['moonlight-cafe', 'sunset-steps', 'laneway-gallery']) await ensureSaved(page, slug)

    const detailPath = '/plans/moonlight-cafe'
    await page.goto(detailPath)
    const savedCategories = page.getByRole('navigation', { name: 'Saved categories' })
    await expect(savedCategories.getByRole('link', { name: 'All', exact: true })).toBeVisible()
    await expect(savedCategories.getByRole('link').nth(1)).toBeVisible()

    const originalReview = `Live review ${suffix}`
    const updatedReview = `Updated live review ${suffix}`
    await page.getByLabel('Your rating').selectOption('5')
    await page.getByLabel('Review').fill(originalReview)
    await submitServerAction(page, 'Post review', 'Your review was saved.', detailPath)

    let reviewSection = page.getByTestId('saved-place-reviews')
    let ownReviewCard = reviewSection.locator('article').filter({ hasText: owner.displayName })
    await expect(ownReviewCard.getByText(originalReview, { exact: true })).toBeVisible({ timeout: 30_000 })

    await page.getByLabel('Your rating').selectOption('4')
    await page.getByLabel('Review').fill(updatedReview)
    await submitServerAction(page, 'Update review', 'Your review was saved.', detailPath)

    reviewSection = page.getByTestId('saved-place-reviews')
    ownReviewCard = reviewSection.locator('article').filter({ hasText: owner.displayName })
    await expect(ownReviewCard.getByText(updatedReview, { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(ownReviewCard.getByText(originalReview, { exact: true })).toHaveCount(0)
    await expect(ownReviewCard.getByLabel('4 out of 5 stars')).toBeVisible()

    await submitServerAction(page, 'Delete my review', 'Your review was removed.', detailPath)
    reviewSection = page.getByTestId('saved-place-reviews')
    ownReviewCard = reviewSection.locator('article').filter({ hasText: owner.displayName })
    await expect(ownReviewCard).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Post review' })).toBeVisible()

    await page.goto('/matches?tab=add')
    await page.getByPlaceholder('Search name or @username').fill(friend.username)
    await page.getByRole('button', { name: 'Search for friends' }).click()
    const result = page.locator('.figma-friends-search-results > div').filter({ hasText: friend.username }).first()
    await expect(result).toBeVisible({ timeout: 30_000 })
    await result.getByRole('button').last().click()

    const cancel = page.getByRole('button', { name: `Cancel friend request to ${friend.displayName}` })
    await expect(cancel).toBeVisible({ timeout: 30_000 })
    await cancel.click()
    await expect(cancel).toHaveCount(0)

    await page.goto('/map?view=map')
    const map = page.getByTestId('feed-map-canvas')
    const catalogueMarker = map.locator('.location-map-marker.is-catalogue').first()
    await expect(catalogueMarker).toBeVisible({ timeout: 30_000 })
    await catalogueMarker.click()
    await expect(map.getByRole('link', { name: 'Open details' })).toBeVisible()
  } finally {
    if (ownerCreated) await deleteDisposableAccount(page)
    if (friendCreated && friendPage) await deleteDisposableAccount(friendPage)
    if (friendContext) await friendContext.close().catch(() => {})
  }
})
