import { test, expect } from '@playwright/test'
import {
  admin,
  completeProfileDirect,
  createConfirmedUser,
  signInThroughUi
} from './support.mjs'

async function seedFigmaFeedFixture(userId) {
  const { data: location, error: locationError } = await admin
    .from('locations')
    .select('id,slug,name,kind,summary,city,neighborhood,cover_path,status')
    .eq('slug', 'moonlight-cafe')
    .single()
  if (locationError) throw locationError

  const originalLocation = {
    name: location.name,
    kind: location.kind,
    summary: location.summary,
    city: location.city,
    neighborhood: location.neighborhood,
    cover_path: location.cover_path,
    status: location.status
  }

  const { error: locationUpdateError } = await admin
    .from('locations')
    .update({
      name: 'Maple Grove Park',
      kind: 'park',
      summary: 'A quiet Oakville park made for picnics and long afternoons.',
      city: 'Oakville',
      neighborhood: 'Oakville',
      cover_path: null,
      status: 'published'
    })
    .eq('id', location.id)
  if (locationUpdateError) throw locationUpdateError

  const { error: stateError } = await admin
    .from('user_content_states')
    .insert({
      profile_id: userId,
      location_id: location.id,
      state: 'saved'
    })
  if (stateError) throw stateError

  const createdAt = new Date(Date.now() - (2 * 60 + 5) * 60 * 1000).toISOString()
  const { data: post, error: postError } = await admin
    .from('social_posts')
    .insert({
      author_id: userId,
      location_id: location.id,
      title: 'Maple Grove Park',
      body: 'This place is amazing! The atmosphere is beautiful, the location feels welcoming, and there’s so much to see and do. Definitely a spot I’d come back to.',
      visibility: 'public',
      created_at: createdAt
    })
    .select('id')
    .single()
  if (postError) throw postError

  return { locationId: location.id, postId: post.id, originalLocation }
}

async function seedSavedFixture(userId) {
  const { data: locations, error } = await admin
    .from('locations')
    .select('id,slug')
    .eq('status', 'published')
    .not('slug', 'is', null)
    .order('slug', { ascending: true })
    .limit(6)
  if (error) throw error
  if (!locations || locations.length < 3) throw new Error('Saved visual fixture requires at least three published locations')

  const { error: stateError } = await admin
    .from('user_content_states')
    .insert(locations.map((location) => ({
      profile_id: userId,
      location_id: location.id,
      state: 'saved'
    })))
  if (stateError) throw stateError

  return {
    locationIds: locations.map((location) => location.id),
    slugs: locations.map((location) => location.slug)
  }
}

async function cleanupFixture({ userId, postId, locationId, originalLocation }) {
  if (postId) await admin.from('social_posts').delete().eq('id', postId)
  if (locationId) {
    await admin
      .from('user_content_states')
      .delete()
      .eq('profile_id', userId)
      .eq('location_id', locationId)
      .eq('state', 'saved')
  }
  if (locationId && originalLocation) {
    await admin.from('locations').update(originalLocation).eq('id', locationId)
  }
}

async function cleanupSavedFixture(userId, locationIds = []) {
  if (!locationIds.length) return
  await admin
    .from('user_content_states')
    .delete()
    .eq('profile_id', userId)
    .in('location_id', locationIds)
    .eq('state', 'saved')
}

async function settleVisuals(page) {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready
  })
  await page.waitForTimeout(100)
}

function expectNear(actual, expected, tolerance = 2) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

async function box(locator) {
  const value = await locator.boundingBox()
  expect(value).toBeTruthy()
  return value
}

async function assertDesktopFeedGeometry(page) {
  const post = await box(page.getByTestId('feed-post').first())
  const tabs = await box(page.getByTestId('feed-tabs'))
  const search = await box(page.getByTestId('feed-search'))
  const composer = await box(page.getByTestId('feed-composer'))

  const controlsBottom = Math.max(tabs.y + tabs.height, search.y + search.height)
  expect(post.y).toBeGreaterThanOrEqual(controlsBottom - 1)
  expect(composer.y).toBeGreaterThanOrEqual(post.y + post.height)

  expectNear(post.x, 527, 2)
  expectNear(post.y, 108, 2)
  expectNear(post.width, 469, 1)
  expect(post.height).toBeGreaterThanOrEqual(511)
  expectNear(tabs.x, 684.31, 2)
  expectNear(tabs.y, 38.99, 2)
  expectNear(tabs.width, 152, 1)
  expectNear(tabs.height, 45.76, 1)
  expectNear(search.x, 1064, 2)
  expectNear(search.y, 42, 2)
  expectNear(search.width, 190, 1)
  expectNear(search.height, 40, 1)
  expectNear(composer.x, 555, 3)
  expect(composer.y - (post.y + post.height)).toBeGreaterThanOrEqual(110)
  expect(composer.y - (post.y + post.height)).toBeLessThanOrEqual(126)
  expectNear(composer.width, 420, 1)
}

async function assertDesktopSavedGeometry(page) {
  const card = await box(page.getByTestId('saved-card').first())
  const tabs = await box(page.getByTestId('saved-tabs'))
  const categories = await box(page.getByTestId('saved-categories'))
  const search = await box(page.getByTestId('saved-search'))

  expectNear(card.x, 303, 3)
  expectNear(card.y, 173, 3)
  expectNear(card.width, 297, 2)
  expectNear(card.height, 233, 2)
  expectNear(tabs.y, 40, 2)
  expectNear(tabs.width, 147, 3)
  expectNear(categories.y, 111, 3)
  expectNear(search.x, 540, 3)
  expectNear(search.y, 736, 3)
  expectNear(search.width, 420, 2)
  expectNear(search.height, 52, 2)
}

async function assertDesktopSavedDetailGeometry(page) {
  const card = await box(page.getByTestId('saved-detail-card'))
  const map = await box(page.getByTestId('saved-detail-map'))
  const similar = await box(page.getByTestId('saved-similar'))
  const search = await box(page.getByTestId('saved-detail-search'))

  expectNear(card.x, 296, 3)
  expectNear(card.y, 173, 3)
  expectNear(card.width, 962, 3)
  expectNear(card.height, 970, 3)
  expectNear(map.x, 860.5, 5)
  expectNear(map.y, 194.5, 4)
  expectNear(map.width, 370, 3)
  expectNear(map.height, 583, 3)
  expectNear(similar.x, 289, 3)
  expectNear(similar.y, 1166.65, 4)
  expectNear(search.x, 553, 3)
  expectNear(search.y - (similar.y + similar.height), 22, 5)
  expectNear(search.width, 420, 2)
}

async function assertMobileSavedGeometry(page) {
  const card = await box(page.getByTestId('saved-card').first())
  expectNear(card.x, 15, 2)
  expectNear(card.width, 372, 3)
  const noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  expect(noHorizontalOverflow).toBeTruthy()
}

test('Feed and Map preserve the approved Figma composition', async ({ page }, testInfo) => {
  const account = await createConfirmedUser({ displayName: 'Richie Zheng' })
  await completeProfileDirect(account.user.id, {
    display_name: 'Richie Zheng',
    city: 'Oakville',
    region: 'Ontario',
    country: 'Canada',
    country_code: 'CA',
    latitude: 43.4675,
    longitude: -79.6877
  })

  const fixture = await seedFigmaFeedFixture(account.user.id)

  try {
    await signInThroughUi(page, account.email, account.password, '/map')
    await page.goto('/map')
    await settleVisuals(page)

    await expect(page.getByTestId('feed-screen')).toHaveAttribute('data-view', 'feed')
    await expect(page.getByTestId('feed-tabs').getByRole('link', { name: 'Feed', exact: true })).toBeVisible()
    await expect(page.getByTestId('feed-tabs').getByRole('link', { name: 'Map', exact: true })).toBeVisible()
    await expect(page.getByTestId('feed-search')).toBeVisible()
    await expect(page.getByTestId('feed-post').first()).toBeVisible()
    await expect(page.getByTestId('feed-composer')).toBeVisible()
    if (testInfo.project.name === 'figma-desktop') await assertDesktopFeedGeometry(page)

    await expect(page).toHaveScreenshot('feed-route.png', {
      animations: 'disabled',
      fullPage: false,
      maxDiffPixelRatio: 0.012
    })

    await page.goto('/map?view=map')
    await settleVisuals(page)

    await expect(page.getByTestId('feed-screen')).toHaveAttribute('data-view', 'map')
    await expect(page.getByTestId('feed-map-canvas')).toBeVisible()
    await expect(page.getByTestId('feed-tabs').getByRole('link', { name: 'Feed', exact: true })).toBeVisible()
    await expect(page.getByTestId('feed-tabs').getByRole('link', { name: 'Map', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to Swipe' })).toBeVisible()
    // The map now loads catalogue data by viewport and centers on the signed-in
    // user's profile region. A saved location can therefore be rendered in the
    // absolute marker layer while legitimately sitting outside the current canvas.
    await expect(page.getByTestId('map-search')).toHaveCount(0)
    const savedMarker = page.getByRole('button', { name: 'Maple Grove Park, Saved' })
    await expect(savedMarker).toHaveCount(1)
    await expect(savedMarker).toHaveClass(/is-saved/)
    await expect(savedMarker).toHaveAttribute('style', /translate3d\(/)
  } finally {
    await cleanupFixture({ userId: account.user.id, ...fixture })
  }
})

test('Saved list and detail preserve the approved desktop Figma relationships', async ({ page }, testInfo) => {
  const account = await createConfirmedUser({ displayName: 'Saved Visual' })
  await completeProfileDirect(account.user.id, {
    display_name: 'Saved Visual',
    city: 'Oakville',
    region: 'Ontario',
    country: 'Canada',
    country_code: 'CA',
    latitude: 43.4675,
    longitude: -79.6877
  })

  const fixture = await seedSavedFixture(account.user.id)

  try {
    await signInThroughUi(page, account.email, account.password, '/plans')
    await page.goto('/plans')
    await settleVisuals(page)

    await expect(page.getByTestId('saved-screen')).toHaveAttribute('data-tab', 'saved')
    await expect(page.getByTestId('saved-tabs').getByRole('link', { name: 'Saved', exact: true })).toBeVisible()
    await expect(page.getByTestId('saved-tabs').getByRole('link', { name: 'Plans', exact: true })).toBeVisible()
    await expect(page.getByTestId('saved-card').first()).toBeVisible()
    await expect(page.getByTestId('saved-search')).toBeVisible()

    if (testInfo.project.name === 'figma-desktop') {
      await assertDesktopSavedGeometry(page)
      await page.addStyleTag({ content: '[data-testid="saved-card"] a { background-image: none !important; }' })
      await expect(page).toHaveScreenshot('saved-route.png', {
        animations: 'disabled',
        fullPage: false,
        maxDiffPixelRatio: 0.012
      })
    } else {
      await assertMobileSavedGeometry(page)
    }

    await page.goto(`/plans/${fixture.slugs[0]}`)
    await settleVisuals(page)
    await expect(page.getByTestId('saved-detail-screen')).toBeVisible()
    await expect(page.getByTestId('saved-detail-card')).toBeVisible()
    await expect(page.getByTestId('saved-detail-map')).toBeVisible()
    await expect(page.getByTestId('saved-similar')).toBeVisible()

    if (testInfo.project.name === 'figma-desktop') {
      await assertDesktopSavedDetailGeometry(page)
      await page.setViewportSize({ width: 1280, height: 1567 })
      await settleVisuals(page)
      await page.addStyleTag({ content: '[data-testid="saved-detail-media"] > div, [data-testid="saved-similar"] a > span { background-image: none !important; } .location-map-tiles { visibility: hidden !important; }' })
      await expect(page).toHaveScreenshot('saved-detail-route.png', {
        animations: 'disabled',
        fullPage: false,
        maxDiffPixelRatio: 0.012
      })
    } else {
      const detailCard = await box(page.getByTestId('saved-detail-card'))
      const detailMap = await box(page.getByTestId('saved-detail-map'))
      expect(detailMap.y).toBeGreaterThan(detailCard.y)
      const noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
      expect(noHorizontalOverflow).toBeTruthy()
    }
  } finally {
    await cleanupSavedFixture(account.user.id, fixture.locationIds)
  }
})
