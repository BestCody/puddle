import { test, expect } from '@playwright/test'
import {
  completeProfileDirect,
  createConfirmedUser,
  signInThroughUi
} from './support.mjs'

test('desktop Figma sidebar navigates, switches to concise mode, and preserves that state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop sidebar only')

  const account = await createConfirmedUser({ displayName: 'Sidebar Behavior Tester' })
  await completeProfileDirect(account.user.id, { display_name: 'Sidebar Behavior Tester' })
  await signInThroughUi(page, account.email, account.password)
  await expect(page).toHaveURL(/\/discover$/)

  const sidebar = page.locator('.figma-dashboard-sidebar')
  const nav = sidebar.locator('.figma-dashboard-nav')
  const productLinks = nav.locator('.figma-dashboard-nav-item')
  const resizer = page.getByRole('separator', { name: 'Resize navigation sidebar' })

  await expect(sidebar).toBeVisible()
  await expect(sidebar).toHaveClass(/is-expanded/)
  await expect(productLinks).toHaveCount(6)
  await expect(nav.locator('a[href="/discover"]')).toHaveAttribute('aria-current', 'page')
  await expect(sidebar.locator('.figma-dashboard-settings-link')).toBeVisible()

  await resizer.focus()
  await resizer.press('Home')
  await expect(sidebar).toHaveClass(/is-concise/)
  await expect(sidebar.locator('.figma-dashboard-nav-label').first()).toBeHidden()
  await expect(sidebar.locator('.figma-dashboard-settings-link')).toBeHidden()

  await nav.locator('a[href="/map"]').click()
  await expect(page).toHaveURL(/\/map(?:\?|$)/)
  await expect(page.getByTestId('feed-screen')).toBeVisible()
  await expect(page.locator('.figma-dashboard-nav a[href="/map"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.figma-dashboard-sidebar')).toHaveClass(/is-concise/)

  await page.reload()
  await expect(page.locator('.figma-dashboard-sidebar')).toHaveClass(/is-concise/)
  await expect(page.locator('.figma-dashboard-nav a[href="/map"]')).toHaveAttribute('aria-current', 'page')

  await page.getByRole('separator', { name: 'Resize navigation sidebar' }).focus()
  await page.getByRole('separator', { name: 'Resize navigation sidebar' }).press('End')
  await expect(page.locator('.figma-dashboard-sidebar')).toHaveClass(/is-expanded/)
  await expect(page.locator('.figma-dashboard-settings-link')).toBeVisible()

  await page.locator('.figma-dashboard-nav a[href="/profile"]').click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.locator('.figma-profile-screen')).toBeVisible()
  await expect(page.locator('.figma-dashboard-nav a[href="/profile"]')).toHaveAttribute('aria-current', 'page')

  await page.locator('.figma-dashboard-settings-link').click()
  await expect(page).toHaveURL(/\/account\?returnTo=%2Fprofile$/)
  await expect(page.locator('.figma-settings-screen')).toBeVisible()
  const close = page.getByRole('link', { name: 'Close settings' })
  await expect(close).toHaveAttribute('href', '/profile')
  await close.click()
  await expect(page).toHaveURL(/\/profile$/)
})

test('short and zoom-like desktop heights keep the Figma sidebar non-scrollable and separated', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop sidebar only')

  const account = await createConfirmedUser({ displayName: 'Short Sidebar Tester' })
  await completeProfileDirect(account.user.id, { display_name: 'Short Sidebar Tester' })
  await signInThroughUi(page, account.email, account.password)

  const sidebar = page.locator('.figma-dashboard-sidebar')
  const profile = sidebar.locator('.figma-dashboard-nav a[href="/profile"]')
  const settings = sidebar.locator('.figma-dashboard-settings-link')
  const resizer = page.getByRole('separator', { name: 'Resize navigation sidebar' })

  for (const height of [600, 460]) {
    await page.setViewportSize({ width: 1280, height })
    await expect(sidebar).toBeVisible()
    await expect(profile).toBeVisible()
    await expect(settings).toBeVisible()
    await expect(settings).toBeInViewport()

    const structure = await sidebar.evaluate((element) => {
      const profileLink = element.querySelector('.figma-dashboard-nav a[href="/profile"]')
      const settingsLink = element.querySelector('.figma-dashboard-settings-link')
      const profileRect = profileLink.getBoundingClientRect()
      const settingsRect = settingsLink.getBoundingClientRect()
      return {
        canScrollVertically: element.scrollHeight > element.clientHeight + 1,
        separated: settingsRect.top > profileRect.bottom,
        settingsInsideViewport: settingsRect.bottom <= window.innerHeight + 1
      }
    })

    expect(structure.canScrollVertically).toBeFalsy()
    expect(structure.separated).toBeTruthy()
    expect(structure.settingsInsideViewport).toBeTruthy()
  }

  await resizer.focus()
  await resizer.press('Home')
  await expect(sidebar).toHaveClass(/is-concise/)

  const conciseStructure = await sidebar.evaluate((element) => {
    const logoRect = element.querySelector('.figma-dashboard-sidebar-logo').getBoundingClientRect()
    const navRect = element.querySelector('.figma-dashboard-nav').getBoundingClientRect()
    return {
      canScrollVertically: element.scrollHeight > element.clientHeight + 1,
      logoClearsNav: logoRect.bottom < navRect.top
    }
  })
  expect(conciseStructure.canScrollVertically).toBeFalsy()
  expect(conciseStructure.logoClearsNav).toBeTruthy()

  await resizer.press('End')
  await expect(sidebar).toHaveClass(/is-expanded/)
  await settings.click()
  await expect(page).toHaveURL(/\/account\?returnTo=%2Fdiscover$/)
  const close = page.getByRole('link', { name: 'Close settings' })
  await expect(close).toHaveAttribute('href', '/discover')
  await close.click()
  await expect(page).toHaveURL(/\/discover$/)
})
