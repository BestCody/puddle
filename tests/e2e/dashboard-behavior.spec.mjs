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
  await expect(sidebar.locator('a[href="/account"]')).toHaveText('Settings')

  await expect(page.locator('.figma-swipe-card')).toBeVisible()
  for (const name of ['Back', 'Pass', 'Save', 'Star']) {
    await expect(page.getByRole('button', { name })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Open details' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Close details' }).click()
  await expect(page.locator('.figma-dashboard-account-menu summary')).toBeVisible()
  await assertNoHorizontalOverflow(page)

  await openDesktop(page, '/map')
  const feedTabs = page.locator('.figma-feed-tabs')
  await expect(feedTabs.getByRole('link', { name: 'Feed', exact: true })).toBeVisible()
  await expect(feedTabs.getByRole('link', { name: 'Map', exact: true })).toBeVisible()
  await expect(page.locator('.figma-feed-search')).toBeVisible()
  await feedTabs.getByRole('link', { name: 'Map', exact: true }).click()
  await expect(page).toHaveURL(/\/map\?view=map/)
  await expect(page.locator('.figma-feed-map-screen')).toBeVisible()

  await openDesktop(page, '/plans')
  const savedTabs = page.locator('.figma-saved-tabs')
  await expect(savedTabs.getByRole('link', { name: 'Saved', exact: true })).toBeVisible()
  await expect(savedTabs.getByRole('link', { name: 'Plans', exact: true })).toBeVisible()
  await expect(page.locator('.figma-saved-categories')).toBeVisible()
  await expect(page.locator('.figma-saved-floating-search')).toBeVisible()
  await savedTabs.getByRole('link', { name: 'Plans', exact: true }).click()
  await expect(page).toHaveURL(/\/plans\?tab=planned/)
  await page.getByRole('link', { name: 'Saved', exact: true }).first().click()
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
  await expect(page.locator('.figma-settings-section:visible')).toHaveCount(0)
  await page.locator('.figma-settings-local-nav').getByRole('link', { name: 'Profile', exact: true }).click()
  await expect(page.locator('#profile')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
  await page.locator('.figma-settings-local-nav').getByRole('link', { name: 'Billing', exact: true }).click()
  await expect(page.locator('#billing')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Manage billing' })).toHaveAttribute('href', '/membership?view=manage')
})
