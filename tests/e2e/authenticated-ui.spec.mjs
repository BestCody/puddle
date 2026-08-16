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

test('official Figma product UI works across core authenticated pages on desktop and mobile', async ({ page }, testInfo) => {
  const account = await createConfirmedUser({ displayName: 'UI Contract Tester' })
  await completeProfileDirect(account.user.id, { display_name: 'UI Contract Tester' })

  const health = trackFrontendHealth(page, {
    baseURL: testInfo.project.use.baseURL,
    strictConsole: false
  })

  await signInThroughUi(page, account.email, account.password)
  await expect(page).toHaveURL(/\/discover$/)
  await expect(page.locator('.minimal-swipe-card')).toBeVisible()
  for (const name of ['Back', 'Pass', 'Save', 'Star']) await expect(page.getByRole('button', { name })).toBeVisible()

  const filterButton = page.getByRole('button', { name: 'Open filters' })
  const shareButton = page.getByRole('button', { name: 'Send to' })

  if (testInfo.project.name === 'desktop-chromium') {
    // The current desktop Swipe Figma frame contains only the card actions and
    // the compact top-right menu; the legacy filter/share toolbar is absent.
    await expect(filterButton).toBeHidden()
    await expect(shareButton).toBeHidden()

    const menuLines = page.locator('.figma-menu-icon > i')
    await expect(menuLines).toHaveCount(3)
    const firstLine = await menuLines.nth(0).boundingBox()
    const secondLine = await menuLines.nth(1).boundingBox()
    const thirdLine = await menuLines.nth(2).boundingBox()
    expect(firstLine).toBeTruthy()
    expect(secondLine).toBeTruthy()
    expect(thirdLine).toBeTruthy()
    expect(secondLine.y - firstLine.y).toBeGreaterThanOrEqual(4)
    expect(secondLine.y - firstLine.y).toBeLessThanOrEqual(8)
    expect(thirdLine.y - secondLine.y).toBeGreaterThanOrEqual(4)
    expect(thirdLine.y - secondLine.y).toBeLessThanOrEqual(8)

    const sidebar = page.locator('.minimal-product-sidebar')
    const resizer = page.getByRole('separator', { name: 'Resize navigation sidebar' })
    await expect(resizer).toBeVisible()
    const initialSidebar = await sidebar.boundingBox()
    const handle = await resizer.boundingBox()
    expect(initialSidebar.width).toBeGreaterThanOrEqual(270)
    expect(handle).toBeTruthy()
    await page.mouse.move(handle.x + handle.width / 2, handle.y + Math.min(120, handle.height / 2))
    await page.mouse.down()
    await page.mouse.move(handle.x - 125, handle.y + Math.min(120, handle.height / 2), { steps: 8 })
    await page.mouse.up()
    await expect(sidebar).toHaveClass(/is-collapsed/)
    expect(Number(await sidebar.getAttribute('data-sidebar-width'))).toBeLessThan(196)
    await expect(sidebar.locator('.product-nav-label').first()).toBeHidden()
    await expect(sidebar.locator('.product-nav-icon').first()).toBeVisible()
    await resizer.focus()
    await page.keyboard.press('End')
    await expect(sidebar).toHaveClass(/is-expanded/)
    expect(Number(await sidebar.getAttribute('data-sidebar-width'))).toBe(288)
    await expect(sidebar.locator('.product-nav-label').first()).toBeVisible()
  } else {
    // Mobile keeps its dedicated compact controls from the mobile Figma flow.
    await expect(filterButton).toBeVisible()
    await expect(shareButton).toBeVisible()
    const filterBox = await filterButton.boundingBox()
    const shareBox = await shareButton.boundingBox()
    expect(filterBox).toBeTruthy()
    expect(shareBox).toBeTruthy()
    expect(Math.abs((shareBox.y + shareBox.height / 2) - (filterBox.y + filterBox.height / 2))).toBeLessThanOrEqual(8)

    await shareButton.click()
    await expect(page.getByRole('heading', { name: 'Send to' })).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()
  }

  await assertRouteHealth(page)

  await page.goto('/map')
  const feedTabs = page.locator('.figma-feed-segment')
  await expect(feedTabs.getByRole('link', { name: 'Feed', exact: true })).toBeVisible()
  await expect(feedTabs.getByRole('link', { name: 'Map', exact: true })).toBeVisible()
  await expect(page.locator('.figma-feed-search')).toBeVisible()
  await feedTabs.getByRole('link', { name: 'Map', exact: true }).click()
  await expect(page).toHaveURL(/\/map\?view=map/)
  await expect(page.locator('.figma-map-view')).toBeVisible()
  await assertRouteHealth(page)

  await page.goto('/plans')
  const savedTabs = page.locator('.figma-saved-segment')
  await expect(savedTabs.getByRole('link', { name: 'Saved', exact: true })).toBeVisible()
  await expect(savedTabs.getByRole('link', { name: 'Plans', exact: true })).toBeVisible()
  await savedTabs.getByRole('link', { name: 'Plans', exact: true }).click()
  await expect(page).toHaveURL(/\/plans\?tab=planned/)
  await savedTabs.getByRole('link', { name: 'Saved', exact: true }).click()
  await expect(page).toHaveURL(/\/plans\?tab=saved/)
  await assertRouteHealth(page)

  await page.goto('/matches')
  await expect(page.locator('.social-messages-layout')).toBeVisible()
  const socialTabs = page.locator('.social-tabs button')
  await expect(socialTabs).toHaveCount(3)
  const addTab = socialTabs.nth(0)
  const messageTab = socialTabs.nth(1)
  const sharedTab = socialTabs.nth(2)
  await expect(messageTab).toHaveClass(/is-active/)
  await sharedTab.click()
  await expect(page).toHaveURL(/\/matches\?tab=shared/)
  await addTab.click()
  await expect(page).toHaveURL(/\/matches\?tab=friends/)
  await expect(page.getByRole('link', { name: 'Friends' })).toHaveAttribute('aria-current', 'page')
  await assertRouteHealth(page)

  await page.goto('/membership')
  await expect(page.locator('.figma-pass-title')).toContainText('Membership')
  await expect(page.locator('.figma-pass-free').getByText('Free', { exact: true })).toBeVisible()
  await expect(page.locator('.figma-pass-paid').getByText('Pass', { exact: true })).toBeVisible()
  await expect(page.getByText('Notification alerts', { exact: true })).toBeVisible()
  const passTabs = page.locator('.figma-pass-segment')
  await passTabs.getByRole('link', { name: 'Manage', exact: true }).click()
  await expect(page).toHaveURL(/\/membership\?view=manage/)
  await expect(page.getByRole('heading', { name: 'Manage membership' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Pass' })).toHaveAttribute('aria-current', 'page')
  await assertRouteHealth(page)

  await page.goto('/account')
  await expect(page.locator('.figma-settings-page')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Profile settings' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Billing' })).toHaveAttribute('href', '/membership?view=manage')
  await assertRouteHealth(page)

  await page.goto('/profile')
  await expect(page.locator('.minimal-profile-card h1')).toHaveText('UI Contract Tester')
  await expect(page.locator('.minimal-profile-settings > :nth-child(1) > span')).toHaveText('Puddles')
  await expect(page.locator('.minimal-profile-settings > :nth-child(2) > span')).toHaveText('Location')
  await expect(page.locator('.minimal-profile-settings > :nth-child(3) > span')).toHaveText('Saves')
  await expect(page.locator('.minimal-profile-settings > :nth-child(4) > span')).toHaveText('Friends')
  await expect(page.getByLabel('Change profile photo')).toBeVisible()
  await expect(page.getByText('Advanced', { exact: true })).toHaveCount(0)
  await expect(page.locator('.minimal-advanced-settings')).toHaveCount(0)
  await assertRouteHealth(page)

  const activeLabels = await page.locator('[aria-current="page"]').allTextContents()
  expect(activeLabels.join(' ')).toContain('Profile')
  health.assertHealthy()
})

test('changing a profile picture uploads and renders the actual color image after reload', async ({ page, request }) => {
  const account = await createConfirmedUser({ displayName: 'Profile Photo Tester' })
  await completeProfileDirect(account.user.id, { display_name: 'Profile Photo Tester' })
  await signInThroughUi(page, account.email, account.password, '/profile')
  await expect(page.locator('.minimal-profile-card h1')).toHaveText('Profile Photo Tester')

  const imageBuffer = await sharp({
    create: {
      width: 96,
      height: 96,
      channels: 3,
      background: { r: 238, g: 70, b: 122 }
    }
  }).png().toBuffer()

  // Profile photo management remains functional, but the current Figma puts
  // it behind the large + card instead of rendering an always-open settings UI.
  await page.getByLabel('Change profile photo').click()
  const editor = page.locator('.figma-profile-photo-popover .profile-photo-editor')
  await expect(editor).toBeVisible()
  const input = editor.locator('input[type="file"]')
  await input.setInputFiles({ name: 'profile-test.png', mimeType: 'image/png', buffer: imageBuffer })
  await expect(editor.getByAltText('Profile preview')).toBeVisible()
  await editor.getByRole('button', { name: 'Save photo' }).click()
  await expect(editor.getByText('Profile picture updated.')).toBeVisible({ timeout: 20_000 })

  await page.reload()
  const profileImage = page.locator('.minimal-profile-avatar img')
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