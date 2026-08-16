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

test('authenticated desktop dashboard keeps the current product structure and core interactions usable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop dashboard contract only')

  const account = await createConfirmedUser({ displayName: 'Dashboard Behavior Tester' })
  await completeProfileDirect(account.user.id, {
    display_name: 'Dashboard Behavior Tester',
    username: `dashboardbehavior${Date.now()}`,
    location_label: 'Oakville',
    interests: ['bar', 'nightlife', 'shop']
  })

  await page.setViewportSize({ width: 1280, height: 832 })
  await signInThroughUi(page, account.email, account.password)
  await expect(page).toHaveURL(/\/discover$/)

  const sidebar = page.locator('.minimal-product-sidebar')
  await expect(sidebar).toBeVisible()
  await expect(sidebar.locator('.minimal-sidebar-logo img')).toHaveAttribute('src', '/puddle-mark-outline.svg')

  const nav = sidebar.locator('.minimal-product-nav')
  for (const href of ['/discover', '/map', '/plans', '/matches', '/membership', '/profile', '/account']) {
    await expect(nav.locator(`a[href="${href}"]`)).toBeVisible()
  }

  await expect(page.locator('.minimal-swipe-card')).toBeVisible()
  for (const name of ['Back', 'Pass', 'Save', 'Star']) {
    await expect(page.getByRole('button', { name })).toBeVisible()
  }
  await expect(page.locator('.minimal-swipe-details-button')).toBeVisible()
  await expect(page.locator('.profile-menu summary')).toBeVisible()
  await expect(page.locator('.minimal-swipe-toolbar')).toBeHidden()
  await expect(page.locator('.discover-share-trigger')).toBeHidden()
  await assertNoHorizontalOverflow(page)

  await openDesktop(page, '/map')
  const feedTabs = page.locator('.figma-feed-segment')
  await expect(feedTabs.getByRole('link', { name: 'Feed', exact: true })).toBeVisible()
  await expect(feedTabs.getByRole('link', { name: 'Map', exact: true })).toBeVisible()
  await expect(page.locator('.figma-feed-search')).toBeVisible()
  await feedTabs.getByRole('link', { name: 'Map', exact: true }).click()
  await expect(page).toHaveURL(/\/map\?view=map/)
  await expect(page.locator('.figma-map-view')).toBeVisible()

  await openDesktop(page, '/plans')
  const savedTabs = page.locator('.figma-saved-segment')
  await expect(savedTabs.getByRole('link', { name: 'Saved', exact: true })).toBeVisible()
  await expect(savedTabs.getByRole('link', { name: 'Plans', exact: true })).toBeVisible()
  await expect(page.locator('.figma-category-tabs')).toBeVisible()
  await expect(page.locator('.figma-saved-search')).toBeVisible()
  await savedTabs.getByRole('link', { name: 'Plans', exact: true }).click()
  await expect(page).toHaveURL(/\/plans\?tab=planned/)
  await savedTabs.getByRole('link', { name: 'Saved', exact: true }).click()
  await expect(page).toHaveURL(/\/plans\?tab=saved/)

  await openDesktop(page, '/matches')
  await expect(page.locator('.social-messages-layout')).toBeVisible()
  const socialTabs = page.locator('.social-tabs button')
  await expect(socialTabs).toHaveCount(3)
  await expect(socialTabs.nth(1)).toHaveClass(/is-active/)
  await socialTabs.nth(2).click()
  await expect(page).toHaveURL(/\/matches\?tab=shared/)
  await socialTabs.nth(0).click()
  await expect(page).toHaveURL(/\/matches\?tab=friends/)

  await openDesktop(page, '/membership')
  const passCards = page.locator('.figma-pass-card')
  await expect(passCards).toHaveCount(2)
  await expect(page.locator('.figma-pass-free').getByText('Free', { exact: true })).toBeVisible()
  await expect(page.locator('.figma-pass-paid').getByText('Pass', { exact: true })).toBeVisible()
  await expect(page.getByText('Notification alerts', { exact: true })).toBeVisible()
  const passTabs = page.locator('.figma-pass-segment')
  await passTabs.getByRole('link', { name: 'Manage', exact: true }).click()
  await expect(page).toHaveURL(/\/membership\?view=manage/)
  await expect(page.getByRole('heading', { name: 'Manage membership' })).toBeVisible()

  await openDesktop(page, '/profile')
  await expect(page.locator('.minimal-profile-card h1')).toHaveText('Dashboard Behavior Tester')
  await expect(page.locator('.minimal-profile-avatar')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Edit', exact: true })).toBeVisible()
  for (const label of ['Puddles', 'Location', 'Saves', 'Friends']) {
    await expect(page.locator('.minimal-profile-settings').getByText(label, { exact: true }).first()).toBeVisible()
  }
  await expect(page.getByLabel('Change profile photo')).toBeVisible()
  await expect(page.getByText('🍻Bar', { exact: true })).toBeVisible()
  await expect(page.getByText('🌙Nightlife', { exact: true })).toBeVisible()
  await expect(page.getByText('🛍️Shop', { exact: true })).toBeVisible()

  await openDesktop(page, '/account')
  await expect(page.locator('.figma-settings-page')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Profile settings' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Billing' })).toHaveAttribute('href', '/membership?view=manage')
})
