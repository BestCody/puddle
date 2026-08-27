import { test, expect } from '@playwright/test'
import sharp from 'sharp'
import {
  assertNoHorizontalOverflow,
  completeProfileDirect,
  createConfirmedUser,
  signInThroughUi
} from './support.mjs'
import {
  assertImagesLoaded,
  assertProductVisualContract,
  trackFrontendHealth
} from './frontend-health.mjs'

async function assertRouteHealth(page) {
  await assertProductVisualContract(page)
  await assertImagesLoaded(page)
  await assertNoHorizontalOverflow(page)
}

async function attachRender(page, testInfo, name) {
  await testInfo.attach(`${testInfo.project.name}-${name}.png`, {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png'
  })
}

async function assertFeedStructure(page) {
  const screen = page.getByTestId('feed-screen')
  const header = page.getByTestId('feed-header')
  const tabs = page.getByTestId('feed-tabs')
  const stream = page.getByTestId('feed-stream')
  const composer = page.getByTestId('feed-composer')

  await expect(screen).toBeVisible()
  await expect(header).toBeVisible()
  await expect(tabs).toBeVisible()
  await expect(stream).toBeVisible()
  await expect(composer).toBeVisible()

  const headerBox = await header.boundingBox()
  const streamBox = await stream.boundingBox()
  expect(headerBox).toBeTruthy()
  expect(streamBox).toBeTruthy()
  expect(streamBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1)
}

test('core authenticated UI behavior works across desktop and mobile', async ({ page }, testInfo) => {
  const account = await createConfirmedUser({ displayName: 'UI Contract Tester' })
  await completeProfileDirect(account.user.id, { display_name: 'UI Contract Tester' })

  const health = trackFrontendHealth(page, {
    baseURL: testInfo.project.use.baseURL,
    strictConsole: false
  })

  await signInThroughUi(page, account.email, account.password)
  await expect(page).toHaveURL(/\/discover$/)
  await expect(page.locator('.figma-swipe-card')).toBeVisible()
  const undo = page.getByRole('button', { name: 'Undo', exact: true })
  await expect(undo).toBeVisible()
  await expect(undo).toBeDisabled()
  for (const name of ['Pass', 'Save', 'Post']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible()

  if (testInfo.project.name === 'desktop-chromium') {
    const desktopSidebar = page.locator('.figma-dashboard-sidebar')
    await expect(desktopSidebar).toBeVisible()
    await expect(desktopSidebar.locator('.figma-dashboard-settings-link')).toBeVisible()
    await expect(page.locator('.figma-dashboard-account-menu summary')).toBeHidden()
    await expect(desktopSidebar.locator('.figma-dashboard-nav-item')).toHaveCount(6)
  } else {
    await expect(page.locator('.figma-dashboard-sidebar')).toBeHidden()
    await expect(page.locator('.figma-dashboard-mobile-nav')).toBeVisible()
    await expect(page.locator('.figma-dashboard-mobile-nav .figma-dashboard-nav-item')).toHaveCount(6)
  }

  await page.getByRole('button', { name: 'Open details' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Close details' }).click()
  await assertRouteHealth(page)
  await attachRender(page, testInfo, 'swipe')

  await page.goto('/map')
  const feedTabs = page.getByTestId('feed-tabs')
  await expect(feedTabs.getByRole('link', { name: 'Posts', exact: true })).toBeVisible()
  await expect(feedTabs.getByRole('link', { name: 'Map', exact: true })).toBeVisible()
  await assertFeedStructure(page)
  await assertRouteHealth(page)
  await attachRender(page, testInfo, 'feed')
  await feedTabs.getByRole('link', { name: 'Map', exact: true }).click()
  await expect(page).toHaveURL(/\/map\?view=map/)
  await expect(page.getByTestId('feed-map-canvas')).toBeVisible()
  await assertRouteHealth(page)
  await attachRender(page, testInfo, 'map')

  await page.goto('/create/post')
  await expect(page).toHaveURL(/\/create\/post(?:\?.*)?$/)
  await expect(page.getByRole('form', { name: 'Create a puddle post' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveAttribute('placeholder', 'Title')
  await expect(page.getByRole('textbox', { name: 'Description' })).toHaveAttribute('placeholder', 'Description')
  await expect(page.getByRole('button', { name: 'Publish post' })).toBeVisible()
  await assertRouteHealth(page)
  await attachRender(page, testInfo, 'feed-post')

  await page.goto('/plans')
  const savedTabs = page.getByTestId('saved-tabs')
  await expect(savedTabs.getByRole('link', { name: 'Saved', exact: true })).toBeVisible()
  await expect(savedTabs.getByRole('link', { name: 'Plans', exact: true })).toBeVisible()
  await assertRouteHealth(page)
  await attachRender(page, testInfo, 'saved')
  await savedTabs.getByRole('link', { name: 'Plans', exact: true }).click()
  await expect(page).toHaveURL(/\/plans\?tab=planned/)
  await page.getByTestId('saved-tabs').getByRole('link', { name: 'Saved', exact: true }).click()
  await expect(page).toHaveURL(/\/plans\?tab=saved/)

  await page.goto('/matches')
  await expect(page.locator('.figma-friends-message-layout')).toBeVisible()
  await assertRouteHealth(page)
  await attachRender(page, testInfo, 'friends-message')
  const friendsTabs = page.locator('.figma-friends-tabs')
  await friendsTabs.getByRole('link', { name: 'Shared', exact: true }).click()
  await expect(page).toHaveURL(/\/matches\?tab=shared/)
  await expect(page.locator('.figma-friends-shared-view')).toBeVisible()
  await attachRender(page, testInfo, 'friends-shared')
  await page.locator('.figma-friends-tabs').getByRole('link', { name: 'Add', exact: true }).click()
  await expect(page).toHaveURL(/\/matches\?tab=add/)
  await expect(page.locator('.figma-friends-add-view')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Friends' })).toHaveAttribute('aria-current', 'page')
  await assertRouteHealth(page)
  await attachRender(page, testInfo, 'friends-add')

  await page.goto('/membership')
  await expect(page.locator('.figma-pass-heading')).toContainText('Membership')
  await expect(page.locator('.figma-pass-plan-free').getByText('Free', { exact: true })).toBeVisible()
  await expect(page.locator('.figma-pass-plan-paid').getByText('Pass', { exact: true })).toBeVisible()
  await expect(page.getByText('Notification alerts', { exact: true })).toBeVisible()
  await assertRouteHealth(page)
  await attachRender(page, testInfo, 'pass-plans')
  await page.locator('.figma-pass-tabs').getByRole('link', { name: 'Manage', exact: true }).click()
  await expect(page).toHaveURL(/\/membership\?view=manage/)
  await expect(page.locator('.figma-pass-current-plan')).toBeVisible()
  await expect(page.locator('.figma-pass-history')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Pass' })).toHaveAttribute('aria-current', 'page')
  await assertRouteHealth(page)
  await attachRender(page, testInfo, 'pass-manage-free')

  await page.goto('/account')
  await expect(page.locator('.figma-settings-window')).toBeVisible()
  await expect(page.locator('.figma-settings-section:visible')).toHaveCount(7)
  await attachRender(page, testInfo, 'settings-default')
  if (testInfo.project.name === 'desktop-chromium') {
    await page.locator('.figma-settings-local-nav').getByRole('link', { name: 'Profile', exact: true }).click()
  }
  await expect(page.locator('#profile')).toBeVisible()
  await attachRender(page, testInfo, 'settings-profile')
  if (testInfo.project.name === 'desktop-chromium') {
    await page.locator('.figma-settings-local-nav').getByRole('link', { name: 'Billing', exact: true }).click()
  }
  await expect(page.locator('#billing')).toBeVisible()
  await expect(page.getByRole('link', { name: 'View plans' })).toHaveAttribute('href', '/membership')
  await assertRouteHealth(page)

  await page.goto('/profile')
  await expect(page.locator('.figma-profile-identity h1')).toHaveText('UI Contract Tester')
  for (const label of ['Puddles', 'Location', 'Saves', 'Friends']) {
    await expect(page.locator('.figma-profile-cards').getByText(label, { exact: true }).first()).toBeVisible()
  }
  await expect(page.getByLabel('Change profile photo')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Edit', exact: true })).toHaveAttribute('href', '/profile?customize=1')
  await assertRouteHealth(page)
  await attachRender(page, testInfo, 'profile')
  await page.getByRole('link', { name: 'Edit', exact: true }).click()
  await expect(page).toHaveURL(/\/profile\?customize=1/)
  await expect(page.locator('.figma-profile-theme-picker')).toBeVisible()
  await attachRender(page, testInfo, 'profile-customize')

  const activeLabels = await page.locator('[aria-current="page"]').allTextContents()
  expect(activeLabels.join(' ')).toContain('Profile')
  health.assertHealthy()
})

test('changing a profile picture uploads and renders the actual color image after reload', async ({ page, request }) => {
  const account = await createConfirmedUser({ displayName: 'Profile Photo Tester' })
  await completeProfileDirect(account.user.id, { display_name: 'Profile Photo Tester' })
  await signInThroughUi(page, account.email, account.password, '/profile')
  await expect(page.locator('.figma-profile-identity h1')).toHaveText('Profile Photo Tester')

  const imageBuffer = await sharp({
    create: {
      width: 96,
      height: 96,
      channels: 3,
      background: { r: 238, g: 70, b: 122 }
    }
  }).png().toBuffer()

  await page.getByLabel('Change profile photo').click()
  const editor = page.locator('.figma-profile-photo-editor .profile-photo-editor')
  await expect(editor).toBeVisible()
  const input = editor.locator('input[type="file"]')
  await input.setInputFiles({ name: 'profile-test.png', mimeType: 'image/png', buffer: imageBuffer })
  await expect(editor.getByAltText('Profile preview')).toBeVisible()
  await editor.getByRole('button', { name: 'Save photo' }).click()
  await expect(editor.getByText('Profile picture updated.')).toBeVisible({ timeout: 20_000 })

  await page.reload()
  const profileImage = page.locator('.figma-profile-avatar img')
  await expect(profileImage).toBeVisible()
  await expect.poll(async () => profileImage.evaluate((image) => image.complete && image.naturalWidth > 0)).toBeTruthy()
  const src = await profileImage.getAttribute('src')
  expect(src).toBeTruthy()

  const response = await request.get(src)
  expect(response.ok()).toBeTruthy()
  expect(response.headers()['content-type'] || '').toMatch(/^image\//)
  const persisted = await response.body()
  const stats = await sharp(persisted).stats()
  expect(stats.channels[0].mean).toBeGreaterThan(stats.channels[1].mean + 80)
})
