import { test, expect } from '@playwright/test'
import {
  completeProfileDirect,
  createConfirmedUser,
  signInThroughUi
} from './support.mjs'

test('desktop Figma sidebar keeps navigation visible and marks the active product section', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop sidebar only')

  const account = await createConfirmedUser({ displayName: 'Sidebar Behavior Tester' })
  await completeProfileDirect(account.user.id, { display_name: 'Sidebar Behavior Tester' })
  await signInThroughUi(page, account.email, account.password)
  await expect(page).toHaveURL(/\/discover$/)

  const sidebar = page.locator('.figma-dashboard-sidebar')
  const nav = sidebar.locator('.figma-dashboard-nav')
  const productLinks = nav.locator('.figma-dashboard-nav-item')

  await expect(sidebar).toBeVisible()
  await expect(productLinks).toHaveCount(6)
  await expect(nav.locator('a[href="/discover"]')).toHaveAttribute('aria-current', 'page')
  await expect(sidebar.locator('.figma-dashboard-settings-link')).toBeVisible()

  await nav.locator('a[href="/map"]').click()
  await expect(page).toHaveURL(/\/map(?:\?|$)/)
  await expect(page.locator('.figma-feed-screen')).toBeVisible()
  await expect(page.locator('.figma-dashboard-nav a[href="/map"]')).toHaveAttribute('aria-current', 'page')

  await page.reload()
  await expect(page.locator('.figma-dashboard-sidebar')).toBeVisible()
  await expect(page.locator('.figma-dashboard-nav a[href="/map"]')).toHaveAttribute('aria-current', 'page')

  await page.locator('.figma-dashboard-nav a[href="/profile"]').click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.locator('.figma-profile-screen')).toBeVisible()
  await expect(page.locator('.figma-dashboard-nav a[href="/profile"]')).toHaveAttribute('aria-current', 'page')

  await page.locator('.figma-dashboard-settings-link').click()
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.locator('.figma-settings-screen')).toBeVisible()
})
