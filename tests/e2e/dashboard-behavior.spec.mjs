import { test, expect } from '@playwright/test'
import {
  assertNoHorizontalOverflow,
  completeProfileDirect,
  createConfirmedUser,
  signInThroughUi
} from './support.mjs'

async function openDesktop(page, path) {
  await page.setViewportSize({ width: 1280, height: 832 })
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  await assertNoHorizontalOverflow(page)
}

async function expectCenteredDashboardCanvas(page) {
  const geometry = await page.evaluate(() => {
    const stage = document.querySelector('.figma-dashboard-stage')?.getBoundingClientRect()
    const main = document.querySelector('.figma-dashboard-main')?.getBoundingClientRect()
    if (!stage || !main) return null
    return {
      stageLeft: stage.left,
      stageRight: stage.right,
      mainLeft: main.left,
      mainRight: main.right,
      mainWidth: main.width
    }
  })
  expect(geometry).not.toBeNull()
  const leftGutter = geometry.mainLeft - geometry.stageLeft
  const rightGutter = geometry.stageRight - geometry.mainRight
  expect(Math.abs(leftGutter - rightGutter)).toBeLessThanOrEqual(2)
  expect(geometry.mainWidth).toBeLessThanOrEqual(1001)
}

test('authenticated desktop dashboard keeps navigation and core product behavior usable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop dashboard contract only')

  const account = await createConfirmedUser({ displayName: 'Dashboard Behavior Tester' })
  await completeProfileDirect(account.user.id, {
    display_name: 'Dashboard Behavior Tester',
    username: `dash${String(Date.now()).slice(-8)}`,
    location_label: 'Oakville',
    interests: ['bar', 'nightlife', 'shop']
  })

  await page.setViewportSize({ width: 1280, height: 832 })
  await signInThroughUi(page, account.email, account.password)
  await expect(page).toHaveURL(/\/discover$/)

  const sidebar = page.locator('.figma-dashboard-sidebar')
  await expect(sidebar).toBeVisible()
  await expect(sidebar.locator('.figma-dashboard-sidebar-logo img')).toHaveAttribute('src', '/puddle-mark-outline.svg')

  const nav = sidebar.locator('.figma-dashboard-nav')
  for (const href of ['/discover', '/map', '/plans', '/matches', '/membership', '/profile']) {
    await expect(nav.locator(`a[href="${href}"]`)).toBeVisible()
  }
  const settingsTrigger = sidebar.locator('.figma-dashboard-settings-link')
  await expect(settingsTrigger).toHaveText('Settings')
  await expect(settingsTrigger).toHaveAttribute('type', 'button')
  const discoverUrl = page.url()
  await settingsTrigger.click()
  const settingsOverlay = page.locator('.puddle-settings-overlay')
  await expect(settingsOverlay).toHaveClass(/is-open/)
  await expect(settingsOverlay).toHaveAttribute('aria-hidden', 'false')
  await expect(settingsOverlay.locator('iframe[title="Settings"]')).toBeVisible()
  expect(page.url()).toBe(discoverUrl)
  await page.keyboard.press('Escape')
  await expect(settingsOverlay).not.toHaveClass(/is-open/)
  await expect(settingsOverlay).toHaveAttribute('aria-hidden', 'true')
  expect(page.url()).toBe(discoverUrl)

  await expect(page.locator('.figma-swipe-card')).toBeVisible()
  const undo = page.getByRole('button', { name: 'Message', exact: true })
  await expect(undo).toBeVisible()
  await expect(undo).toBeDisabled()
  for (const name of ['Pass', 'Save', 'Post']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Open details' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Close details' }).click()
  await expect(settingsTrigger).toBeVisible()
  await expect(page.locator('.figma-dashboard-account-menu summary')).toBeHidden()
  await assertNoHorizontalOverflow(page)

  await openDesktop(page, '/map')
  const feedTabs = page.getByTestId('feed-tabs')
  await expect(feedTabs.getByRole('link', { name: 'Posts', exact: true })).toBeVisible()
  await expect(feedTabs.getByRole('link', { name: 'Map', exact: true })).toBeVisible()
  const feedSearch = page.getByTestId('feed-search')
  await expect(feedSearch).toBeVisible()
  await expect(feedSearch).toContainText('Search Puddles')
  await expect(feedSearch).toHaveAttribute('aria-haspopup', 'dialog')
  await expect(feedSearch).toHaveAttribute('aria-expanded', 'false')
  await feedSearch.click()
  const feedSearchbox = page.getByRole('searchbox', { name: 'Search Puddles' })
  await expect(feedSearchbox).toBeVisible()
  await expect(feedSearchbox).toHaveAttribute('placeholder', 'Search Puddles')
  await expect(feedSearch).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(feedSearch).toHaveAttribute('aria-expanded', 'false')

  const feedHeader = await page.getByTestId('feed-header').boundingBox()
  const feedStream = await page.getByTestId('feed-stream').boundingBox()
  expect(feedHeader).toBeTruthy()
  expect(feedStream).toBeTruthy()
  expect(feedStream.y).toBeGreaterThanOrEqual(feedHeader.y + feedHeader.height - 1)

  await openDesktop(page, '/create/post')
  await expect(page.locator('.figma-create-post-blur')).toBeVisible()
  await expect(page.locator('.figma-create-post-card')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveAttribute('placeholder', 'Title')
  await expect(page.getByRole('textbox', { name: 'Description' })).toHaveAttribute('placeholder', 'Description')
  await expect(page.getByText('Who can see this post?', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Post publishing is not connected to a backend yet.', { exact: false })).toHaveCount(0)
  await expect(page.locator('.figma-create-post-visibility').getByText('Public', { exact: true })).toBeVisible()
  await expect(page.locator('.figma-create-post-visibility').getByText('Friends Only', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Open add menu')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Choose a place from the map' })).toBeVisible()

  await openDesktop(page, '/map')
  await page.getByTestId('feed-tabs').getByRole('link', { name: 'Map', exact: true }).click()
  await expect(page).toHaveURL(/\/map\?view=map/)
  await expect(page.getByTestId('feed-map-canvas')).toBeVisible()

  await openDesktop(page, '/plans')
  const savedTabs = page.getByTestId('saved-tabs')
  await expect(savedTabs.getByRole('link', { name: 'Saved', exact: true })).toBeVisible()
  await expect(savedTabs.getByRole('link', { name: 'Plans', exact: true })).toBeVisible()
  await expect(page.getByTestId('saved-categories')).toBeVisible()
  await expect(page.getByTestId('saved-search')).toBeVisible()
  await savedTabs.getByRole('link', { name: 'Plans', exact: true }).click()
  await expect(page).toHaveURL(/\/plans\?tab=planned/)
  await page.getByTestId('saved-tabs').getByRole('link', { name: 'Saved', exact: true }).click()
  await expect(page).toHaveURL(/\/plans\?tab=saved/)

  await openDesktop(page, '/matches')
  await expect(page.locator('.figma-friends-message-layout')).toBeVisible()
  const friendsTabs = page.locator('.figma-friends-tabs')
  await friendsTabs.getByRole('link', { name: 'Shared', exact: true }).click()
  await expect(page).toHaveURL(/\/matches\?tab=shared/)
  await expect(page.locator('.figma-friends-shared-view')).toBeVisible()
  await page.locator('.figma-friends-tabs').getByRole('link', { name: 'Add', exact: true }).click()
  await expect(page).toHaveURL(/\/matches\?tab=add/)
  await expect(page.locator('.figma-friends-add-view')).toBeVisible()

  await openDesktop(page, '/membership')
  await expect(page.locator('.figma-pass-plan')).toHaveCount(2)
  await expect(page.locator('.figma-pass-plan-free').getByText('Free', { exact: true })).toBeVisible()
  await expect(page.locator('.figma-pass-plan-paid').getByText('Pass', { exact: true })).toBeVisible()
  await expect(page.getByText('Notification alerts', { exact: true })).toBeVisible()
  await expect(page.getByText('Billed monthly. Taxes and renewal terms appear before payment.', { exact: true })).toHaveCount(0)
  await page.locator('.figma-pass-tabs').getByRole('link', { name: 'Manage', exact: true }).click()
  await expect(page).toHaveURL(/\/membership\?view=manage/)
  await expect(page.locator('.figma-pass-current-plan')).toBeVisible()
  await expect(page.locator('.figma-pass-history')).toBeVisible()

  await openDesktop(page, '/profile')
  await expect(page.locator('.figma-profile-identity h1')).toHaveText('Dashboard Behavior Tester')
  await expect(page.locator('.figma-profile-avatar')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Edit', exact: true })).toHaveAttribute('href', '/profile?customize=1')
  for (const label of ['Puddles', 'Location', 'Saves', 'Friends']) {
    await expect(page.locator('.figma-profile-cards').getByText(label, { exact: true }).first()).toBeVisible()
  }
  await expect(page.getByLabel('Change profile photo')).toBeVisible()
  await expect(page.getByText('🍻Bar', { exact: true })).toBeVisible()
  await expect(page.getByText('🌙Nightlife', { exact: true })).toBeVisible()
  await expect(page.getByText('🛍️Shop', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Edit', exact: true }).click()
  await expect(page).toHaveURL(/\/profile\?customize=1/)
  await expect(page.locator('.figma-profile-theme-picker')).toBeVisible()

  await openDesktop(page, '/account')
  await expect(page.locator('.figma-settings-window')).toBeVisible()
  await expect(page.locator('.figma-settings-local-nav')).toBeVisible()
  await expect(page.locator('.figma-settings-detail')).toBeVisible()
  const settingsClose = page.getByRole('link', { name: 'Close settings' })
  await expect(settingsClose).toBeVisible()
  await expect(settingsClose).toHaveAttribute('href', '/profile')
  await expect(page.locator('.figma-settings-section:visible')).toHaveCount(7)
  await page.locator('.figma-settings-local-nav').getByRole('link', { name: 'Profile', exact: true }).click()
  await expect(page.locator('#profile')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Close settings' })).toBeVisible()
  await page.locator('.figma-settings-local-nav').getByRole('link', { name: 'Billing', exact: true }).click()
  await expect(page.locator('#billing')).toBeVisible()
  await expect(page.getByRole('link', { name: 'View plans' })).toHaveAttribute('href', '/membership')
  await page.getByRole('link', { name: 'Close settings' }).click()
  await expect(page).toHaveURL(/\/profile$/)

  /* Wide monitors should add balanced whitespace around the authored 1000px
     Figma canvas instead of pinning the dashboard composition to the sidebar. */
  await page.setViewportSize({ width: 1600, height: 900 })
  for (const route of ['/discover', '/map', '/plans', '/matches', '/membership', '/profile', '/account', '/create/post']) {
    await page.goto(route)
    await page.waitForLoadState('networkidle')
    await expectCenteredDashboardCanvas(page)
    await assertNoHorizontalOverflow(page)
  }
})
