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
  await page.setViewportSize({ width: 1280, height: 832 })
  await signInThroughUi(page, account.email, account.password)
  await expect(page).toHaveURL(/\/discover$/)

  const sidebar = page.locator('.figma-dashboard-sidebar')
  const nav = sidebar.locator('.figma-dashboard-nav')
  const productLinks = nav.locator('.figma-dashboard-nav-item')
  const resizer = page.getByRole('separator', { name: 'Resize navigation sidebar' })
  const settings = sidebar.locator('.figma-dashboard-settings-link')

  await expect(sidebar).toBeVisible()
  await expect(sidebar).toHaveClass(/is-expanded/)
  await expect(productLinks).toHaveCount(6)
  await expect(nav.locator('a[href="/discover"]')).toHaveAttribute('aria-current', 'page')
  await expect(settings).toBeVisible()

  await resizer.focus()
  await resizer.press('Home')
  await expect(sidebar).toHaveClass(/is-concise/)
  await expect(sidebar.locator('.figma-dashboard-nav-label').first()).toBeHidden()
  await expect(settings).toBeVisible()
  await expect(settings.locator('.figma-dashboard-settings-label')).toBeHidden()

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

  const profileUrl = page.url()
  await page.locator('.figma-dashboard-settings-link').click()
  const overlay = page.locator('.puddle-settings-overlay')
  await expect(overlay).toHaveClass(/is-open/)
  await expect(overlay).toHaveAttribute('aria-hidden', 'false')
  await expect(overlay.locator('iframe[title="Settings"]')).toBeVisible()
  expect(page.url()).toBe(profileUrl)
  await page.keyboard.press('Escape')
  await expect(overlay).not.toHaveClass(/is-open/)
  await expect(overlay).toHaveAttribute('aria-hidden', 'true')
  expect(page.url()).toBe(profileUrl)
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
    await expect(settings).toHaveCount(1)

    const structure = await sidebar.evaluate((element) => {
      const profileLink = element.querySelector('.figma-dashboard-nav a[href="/profile"]')
      const settingsLink = element.querySelector('.figma-dashboard-settings-link')
      const profileRect = profileLink.getBoundingClientRect()
      const settingsRect = settingsLink.getBoundingClientRect()
      return {
        canScrollVertically: element.scrollHeight > element.clientHeight + 1,
        separated: settingsRect.top > profileRect.bottom
      }
    })

    expect(structure.canScrollVertically).toBeFalsy()
    expect(structure.separated).toBeTruthy()
  }

  await resizer.focus()
  await resizer.press('Home')
  await expect(sidebar).toHaveClass(/is-concise/)
  await expect(settings).toHaveCount(1)
  await expect(settings.locator('.figma-dashboard-settings-label')).toBeHidden()

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

  // The authored fixed-height desktop composition intentionally places the
  // Settings control below a very short viewport instead of making the
  // sidebar scroll. Restore a normal desktop height before testing the
  // Settings interaction itself.
  await page.setViewportSize({ width: 1280, height: 832 })
  await expect(settings).toBeVisible()
  const discoverUrl = page.url()
  await settings.click()
  const overlay = page.locator('.puddle-settings-overlay')
  await expect(overlay).toHaveClass(/is-open/)
  await expect(overlay.locator('iframe[title="Settings"]')).toBeVisible()
  expect(page.url()).toBe(discoverUrl)
  await page.keyboard.press('Escape')
  await expect(overlay).not.toHaveClass(/is-open/)
  expect(page.url()).toBe(discoverUrl)
})
