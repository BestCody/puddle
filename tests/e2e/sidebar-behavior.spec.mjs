import { test, expect } from '@playwright/test'
import {
  completeProfileDirect,
  createConfirmedUser,
  signInThroughUi
} from './support.mjs'

test('desktop sidebar stays usable when collapsed, expanded, navigated, and reloaded', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop sidebar only')

  const account = await createConfirmedUser({ displayName: 'Sidebar Behavior Tester' })
  await completeProfileDirect(account.user.id, { display_name: 'Sidebar Behavior Tester' })
  await signInThroughUi(page, account.email, account.password)
  await expect(page).toHaveURL(/\/discover$/)

  const sidebar = page.locator('.minimal-product-sidebar')
  const resizer = page.getByRole('separator', { name: 'Resize navigation sidebar' })
  const links = sidebar.locator('.minimal-product-nav > a')

  await expect(sidebar).toBeVisible()
  await expect(resizer).toBeVisible()
  await expect(links).toHaveCount(7)

  await resizer.focus()
  await page.keyboard.press('Home')
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await expect(sidebar.locator('.product-nav-label').first()).toBeHidden()
  for (let index = 0; index < 7; index += 1) {
    await expect(links.nth(index).locator('.product-nav-icon')).toBeVisible()
  }

  await sidebar.locator('a[href="/map"]').click()
  await expect(page).toHaveURL(/\/map(?:\?|$)/)
  await expect(page.locator('.figma-feed-page')).toBeVisible()

  await page.reload()
  await expect(page.locator('.minimal-product-sidebar')).toHaveClass(/is-collapsed/)

  await page.getByRole('separator', { name: 'Resize navigation sidebar' }).focus()
  await page.keyboard.press('End')
  await expect(page.locator('.minimal-product-sidebar')).toHaveClass(/is-expanded/)
  await expect(page.locator('.minimal-product-sidebar .product-nav-label').first()).toBeVisible()

  await page.locator('.minimal-product-sidebar a[href="/profile"]').click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.locator('.minimal-profile-page')).toBeVisible()
})
