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
    if (testInfo.project.name === 'figma-desktop') await expect(page.getByTestId('map-search')).toBeHidden()
    else await expect(page.getByTestId('map-search')).toBeVisible()

    await page.addStyleTag({ content: '.location-map-tiles { visibility: hidden !important; }' })
    await expect(page).toHaveScreenshot('map-route.png', {
      animations: 'disabled',
      fullPage: false,
      maxDiffPixelRatio: 0.012
    })
  } finally {
    await cleanupFixture({ userId: account.user.id, ...fixture })
  }
})
