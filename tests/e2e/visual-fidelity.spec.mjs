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
    .select('id,slug')
    .eq('slug', 'moonlight-cafe')
    .single()
  if (locationError) throw locationError

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
    .upsert({
      profile_id: userId,
      location_id: location.id,
      state: 'saved'
    }, { onConflict: 'profile_id,location_id,state' })
  if (stateError) throw stateError

  const createdAt = new Date(Date.now() - (2 * 60 + 5) * 60 * 1000).toISOString()
  const { data: post, error: postError } = await admin
    .from('social_posts')
    .insert({
      author_id: userId,
      location_id: location.id,
      title: 'Maple Grove Park',
      body: 'This place is amazing! The atmosphere is beautiful, the location feels welcoming, and there’s so much to see and do. Definitely a spot I’d come back to.',
      photo_urls: [],
      visibility: 'public',
      created_at: createdAt
    })
    .select('id')
    .single()
  if (postError) throw postError

  return { locationId: location.id, postId: post.id }
}

async function cleanupFixture({ userId, postId, locationId }) {
  if (postId) await admin.from('social_posts').delete().eq('id', postId)
  if (locationId) {
    await admin
      .from('user_content_states')
      .delete()
      .eq('profile_id', userId)
      .eq('location_id', locationId)
      .eq('state', 'saved')
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

async function assertFeedGeometry(page, projectName) {
  const header = await box(page.getByTestId('feed-header'))
  const stream = await box(page.getByTestId('feed-stream'))
  const post = await box(page.getByTestId('feed-post').first())
  const tabs = await box(page.getByTestId('feed-tabs'))
  const search = await box(page.getByTestId('feed-search'))
  const composer = await box(page.getByTestId('feed-composer'))

  expect(stream.y).toBeGreaterThanOrEqual(header.y + header.height - 1)

  if (projectName === 'figma-desktop') {
    expectNear(post.x, 527, 2)
    expectNear(post.y, 108, 2)
    expectNear(post.width, 469, 1)
    expect(post.height).toBeGreaterThanOrEqual(511)
    expectNear(tabs.width, 152, 1)
    expectNear(tabs.height, 45.76, 1)
    expectNear(search.x, 1064, 2)
    expectNear(search.y, 42, 2)
    expectNear(search.width, 190, 1)
    expectNear(search.height, 40, 1)
    expectNear(composer.x, 555, 3)
    expectNear(composer.width, 420, 1)
  } else {
    expectNear(post.x, 19, 1)
    expectNear(post.y, 100, 2)
    expectNear(post.width, 363.67, 1)
    expect(post.height).toBeGreaterThanOrEqual(396.23)
    expectNear(tabs.x, 139.74, 2)
    expectNear(tabs.y, 40.56, 2)
    expectNear(tabs.width, 127.12, 1)
    expectNear(search.x, 318, 2)
    expectNear(search.y, 40, 2)
    expectNear(search.width, 55, 1)
    expectNear(composer.x, 29, 2)
    expectNear(composer.y, 720, 3)
    expectNear(composer.width, 340, 1)
  }
}

async function assertMapGeometry(page, projectName) {
  const tabs = await box(page.getByTestId('feed-tabs'))
  const back = await box(page.getByRole('link', { name: 'Back to Swipe' }))

  if (projectName === 'figma-desktop') {
    expectNear(tabs.x, 697, 2)
    expectNear(tabs.y, 35, 2)
    expectNear(tabs.width, 152, 1)
    expectNear(tabs.height, 55, 1)
    expectNear(back.x, 312, 2)
    expectNear(back.y, 37, 2)
    expectNear(back.width, 55, 1)
    expectNear(back.height, 41, 1)
    await expect(page.getByTestId('map-search')).toBeHidden()
  } else {
    const mapSearch = await box(page.getByTestId('map-search'))
    expectNear(tabs.x, 139.76, 2)
    expectNear(tabs.y, 36.94, 2)
    expectNear(tabs.width, 125.62, 1)
    expectNear(tabs.height, 45.46, 1)
    expectNear(back.x, 27, 2)
    expectNear(back.y, 40, 2)
    expectNear(back.width, 37, 1)
    expectNear(back.height, 38, 1)
    expectNear(mapSearch.x, 102, 2)
    expectNear(mapSearch.y, 713, 2)
    expectNear(mapSearch.width, 190, 1)
    expectNear(mapSearch.height, 44, 1)
  }
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
    await assertFeedGeometry(page, testInfo.project.name)
    await expect(page).toHaveScreenshot('feed-route.png', {
      animations: 'disabled',
      fullPage: false,
      maxDiffPixelRatio: 0.012
    })

    await page.goto('/map?view=map')
    await settleVisuals(page)

    await expect(page.getByTestId('feed-screen')).toHaveAttribute('data-view', 'map')
    await assertMapGeometry(page, testInfo.project.name)
    await expect(page).toHaveScreenshot('map-route.png', {
      animations: 'disabled',
      fullPage: false,
      mask: [page.locator('.location-map-canvas')],
      maxDiffPixelRatio: 0.012
    })
  } finally {
    await cleanupFixture({ userId: account.user.id, ...fixture })
  }
})
