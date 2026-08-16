import { test, expect } from '@playwright/test'
import {
  completeProfileDirect,
  createConfirmedUser,
  signInThroughUi
} from './support.mjs'

const near = (actual, expected, tolerance = 2) => Math.abs(actual - expected) <= tolerance

async function expectBox(locator, expected, label, tolerance = 2) {
  await expect(locator, `${label} should be visible`).toBeVisible()
  const box = await locator.boundingBox()
  expect(box, `${label} should have a layout box`).toBeTruthy()
  for (const [key, value] of Object.entries(expected)) {
    expect(near(box[key], value, tolerance), `${label} ${key}: got ${box[key]}, expected ${value}±${tolerance}`).toBeTruthy()
  }
}

async function openDesktop(page, path) {
  await page.setViewportSize({ width: 1280, height: 832 })
  await page.goto(path)
  await page.waitForLoadState('networkidle')
}

async function attachRender(page, testInfo, name, { fullPage = false } = {}) {
  await testInfo.attach(`${name}-figma-parity`, {
    body: await page.screenshot({ fullPage }),
    contentType: 'image/png'
  })
}

test('authenticated desktop pages follow the Puddle Official Figma geometry', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop Figma geometry only')

  const account = await createConfirmedUser({ displayName: 'Figma Parity Tester' })
  await completeProfileDirect(account.user.id, {
    display_name: 'Figma Parity Tester',
    username: `figmaparity${Date.now()}`,
    location_label: 'Oakville',
    interests: ['bar', 'nightlife', 'shop']
  })

  await page.setViewportSize({ width: 1280, height: 832 })
  await signInThroughUi(page, account.email, account.password)
  await expect(page).toHaveURL(/\/discover$/)
  await page.evaluate(() => window.localStorage.removeItem('puddle:product-sidebar-width'))
  await page.reload()
  await page.waitForLoadState('networkidle')

  const sidebar = page.locator('.minimal-product-sidebar')
  await expect(sidebar).toHaveAttribute('data-sidebar-width', '280')
  await expectBox(sidebar, { x: 0, y: 0, width: 280 }, 'Figma sidebar')
  await expectBox(sidebar.locator('.minimal-product-nav > a').first(), { x: 27, y: 260, width: 241, height: 56 }, 'Swipe sidebar selection', 3)
  await expectBox(page.locator('.profile-menu summary'), { x: 1190, y: 36, width: 49, height: 44 }, 'Swipe menu', 2)
  await expect(page.locator('.minimal-swipe-toolbar')).toBeHidden()
  await expect(page.locator('.discover-share-trigger')).toBeHidden()
  await attachRender(page, testInfo, 'swipe')

  await openDesktop(page, '/map')
  await expectBox(page.locator('.figma-feed-segment'), { x: 684, y: 39, width: 152, height: 46 }, 'Feed/Map switch', 3)
  await expectBox(page.locator('.figma-feed-search'), { x: 1064, y: 42, width: 190, height: 40 }, 'Feed search', 3)
  await expect(page.locator('.minimal-product-header')).toBeHidden()
  const feedLabelContent = await page.locator('.minimal-product-nav > a[href="/map"] .product-nav-label').evaluate((node) => getComputedStyle(node, '::after').content)
  expect(feedLabelContent).toContain('Explore')
  await attachRender(page, testInfo, 'feed')

  await openDesktop(page, '/plans')
  await expectBox(page.locator('.figma-saved-segment'), { x: 690, y: 40, width: 147, height: 48 }, 'Saved/Plans switch', 3)
  await expectBox(page.locator('.figma-category-tabs'), { x: 280, y: 111 }, 'Saved categories', 4)
  await expect(page.locator('.minimal-product-header')).toBeHidden()
  await attachRender(page, testInfo, 'saved')

  await openDesktop(page, '/matches')
  await expectBox(page.locator('.social-tabs'), { x: 666, y: 39, width: 238, height: 48 }, 'Friends tabs', 3)
  await expectBox(page.locator('.social-messages-layout'), { x: 308, y: 102, width: 954, height: 700 }, 'Friends panels', 4)
  await expect(page.locator('.minimal-product-header')).toBeHidden()
  await attachRender(page, testInfo, 'friends')

  await openDesktop(page, '/membership')
  await expectBox(page.locator('.figma-pass-segment'), { x: 666, y: 39, width: 167, height: 48 }, 'Pass tabs', 3)
  const passCards = page.locator('.figma-pass-card')
  await expect(passCards).toHaveCount(2)
  await expectBox(passCards.first(), { x: 403, y: 218, width: 345, height: 455 }, 'Free card', 7)
  await expectBox(passCards.nth(1), { x: 770, y: 218, width: 345, height: 455 }, 'Pass card', 7)
  await expect(page.getByText('Notification alerts', { exact: true })).toBeVisible()
  await expect(page.locator('.minimal-product-header')).toBeHidden()
  await attachRender(page, testInfo, 'pass')

  await openDesktop(page, '/profile')
  await expectBox(page.locator('.minimal-profile-avatar'), { x: 697, y: 241, width: 133, height: 133 }, 'Profile avatar', 4)
  await expectBox(page.locator('.minimal-profile-settings > :nth-child(1)'), { x: 378, y: 660, width: 369, height: 378 }, 'Puddles panel', 4)
  await expectBox(page.locator('.minimal-profile-settings > :nth-child(2)'), { x: 767, y: 658, width: 369, height: 239 }, 'Location panel', 4)
  await expectBox(page.locator('.minimal-profile-settings > :nth-child(3)'), { x: 769, y: 918, width: 369, height: 494 }, 'Saves panel', 4)
  await expectBox(page.locator('.minimal-profile-settings > :nth-child(4)'), { x: 378, y: 1063, width: 369, height: 460 }, 'Friends panel', 4)
  await expectBox(page.locator('.minimal-profile-settings > :nth-child(5)'), { x: 777, y: 1431, width: 369, height: 259 }, 'Profile plus panel', 4)
  await expect(page.locator('.minimal-product-header')).toBeHidden()
  await attachRender(page, testInfo, 'profile', { fullPage: true })

  await openDesktop(page, '/account')
  await expectBox(page.locator('.figma-settings-page'), { x: 107, y: 97, width: 1068, height: 603 }, 'Settings overlay', 3)
  await expect(page.locator('.minimal-product-header')).toBeHidden()
  await attachRender(page, testInfo, 'settings')
})
