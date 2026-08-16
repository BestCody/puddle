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
  for (const name of ['Back', 'Pass', 'Save', 'Star']) await expect(page.getByRole('button', { name })).toBeVisible()

  if (testInfo.project.name === 'desktop-chromium') {
    const desktopSidebar = page.locator('.figma-dashboard-sidebar')
    await expect(desktopSidebar).toBeVisible()
    await expect(page.locator('.figma-dashboard-account-menu summary')).toBeVisible()
    await expect(page.locator('.figma-dashboard-account-menu summary i')).toHaveCount(3)
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
  const feedTabs = page.locator('.figma-feed-tabs')
  await expect(feedTabs.getByRole('link', { name: 'Feed', exact: true })).toBeVisible()
  await expect(feedTabs.getByRole('link', { name: 'Map', exact: true })).toBeVisible()
  await assertRouteHealth(page)
  await attachRender(page, testInfo, 'feed')
  await feedTabs.getByRole('link', { name: 'Map', exact: true }).click()
  await expect(page).toHaveURL(/\/map\?view=map/)
  await expect(page.locator('.figma-feed-map-screen')).toBeVisible()
  await assertRouteHealth(page)
  await attachRender(page, testInfo, 'map')

  await page.goto('/create/post')
  await expect(page.locator('.figma-create-post-card')).toBeVisible()
  await expect(page.getByLabel('Open add menu')).toBeVisible()
  if (testInfo.project.name === 'mobile-chromium') {
    await page.getByLabel('Open add menu').click()
    await expect(page.locator('.figma-create-post-add-menu')).toBeVisible()
    await attachRender(page, testInfo, 'feed-post-add-menu')
    await page.getByLabel('Open add menu').click()
  }
  await assertRouteHealth(page)
  await attachRender(page, testInfo, 'feed-post')

  await page.goto('/plans')
  const savedTabs = page.locator('.figma-saved-tabs')
  await expect(savedTabs.getByRole('link', { name: 'Saved', exact: true })).toBeVisible()
  await expect(savedTabs.getByRole('link', { name: 'Plans', exact: true })).toBeVisible()
  await assertRouteHealth(page)
  await attachRender(page, testInfo, 'saved')
  await savedTabs.getByRole('link', { name: 'Plans', exact: true }).click()
  await expect(page).toHaveURL(/\/plans\?tab=planned/)
  await page.locator('.figma-saved-tabs').getByRole('link', { name: 'Saved', exact: true }).click()
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
  await expect(page.locator('.figma-settings-section:visible')).toHaveCount(0)
  await attachRender(page, testInfo, 'settings-default')
  await page.locator('.figma-settings-local-nav').getByRole('link', { name: 'Profile', exact: true }).click()
  await expect(page.locator('#profile')).toBeVisible()
  await attachRender(page, testInfo, 'settings-profile')
  await page.locator('.figma-settings-local-nav').getByRole('link', { name: 'Billing', exact: true }).click()
  await expect(page.locator('#billing')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Manage billing' })).toHaveAttribute('href', '/membership?view=manage')
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
