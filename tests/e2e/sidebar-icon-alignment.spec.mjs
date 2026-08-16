import { test, expect } from '@playwright/test'
import {
  completeProfileDirect,
  createConfirmedUser,
  signInThroughUi
} from './support.mjs'

test('collapsed sidebar icons share one centerline and stay centered inside every nav bubble', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop sidebar only')

  const account = await createConfirmedUser({ displayName: 'Sidebar Alignment Tester' })
  await completeProfileDirect(account.user.id, { display_name: 'Sidebar Alignment Tester' })
  await signInThroughUi(page, account.email, account.password)
  await expect(page).toHaveURL(/\/discover$/)

  const sidebar = page.locator('.minimal-product-sidebar')
  const resizer = page.getByRole('separator', { name: 'Resize navigation sidebar' })
  await expect(sidebar).toBeVisible()
  await expect(resizer).toBeVisible()

  await resizer.focus()
  await page.keyboard.press('Home')
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await expect(sidebar).toHaveAttribute('data-sidebar-width', '88')

  const links = sidebar.locator('.minimal-product-nav > a')
  await expect(links).toHaveCount(7)

  const iconCenters = []
  for (let index = 0; index < 7; index += 1) {
    const link = links.nth(index)
    const icon = link.locator('.product-nav-icon')
    const linkBox = await link.boundingBox()
    const iconBox = await icon.boundingBox()
    expect(linkBox).toBeTruthy()
    expect(iconBox).toBeTruthy()

    const linkCenterX = linkBox.x + linkBox.width / 2
    const linkCenterY = linkBox.y + linkBox.height / 2
    const iconCenterX = iconBox.x + iconBox.width / 2
    const iconCenterY = iconBox.y + iconBox.height / 2

    expect(Math.abs(iconCenterX - linkCenterX)).toBeLessThanOrEqual(1)
    expect(Math.abs(iconCenterY - linkCenterY)).toBeLessThanOrEqual(1)
    iconCenters.push(iconCenterX)
  }

  expect(Math.max(...iconCenters) - Math.min(...iconCenters)).toBeLessThanOrEqual(1)
})
