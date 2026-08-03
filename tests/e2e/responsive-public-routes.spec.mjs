import { test, expect } from '@playwright/test'
import { assertNoHorizontalOverflow } from './support.mjs'
import { assertImagesLoaded, assertLandingVisualContract, trackFrontendHealth } from './frontend-health.mjs'

const publicPages = [
  ['/', 'Puddle'],
  ['/signin', 'Jump back into your Puddle.'],
  ['/signup', 'Make plans that leave the chat.'],
  ['/privacy', 'Privacy Policy'],
  ['/terms', 'Terms of Service']
]

for (const [path, heading] of publicPages) {
  test(`${path} renders without frontend failures or horizontal overflow`, async ({ page }, testInfo) => {
    const health = trackFrontendHealth(page, {
      baseURL: testInfo.project.use.baseURL,
      strictConsole: path === '/'
    })

    await page.goto(path)
    if (path === '/') {
      await expect(page.locator('body')).toContainText(heading)
    } else {
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
    }

    await assertImagesLoaded(page)
    await assertNoHorizontalOverflow(page)
    health.assertHealthy()
  })
}

test('landing page preserves its desktop and mobile visual structure', async ({ page }, testInfo) => {
  const health = trackFrontendHealth(page, {
    baseURL: testInfo.project.use.baseURL,
    strictConsole: true
  })

  await page.goto('/')
  await assertLandingVisualContract(page)
  await assertImagesLoaded(page)
  await assertNoHorizontalOverflow(page)
  health.assertHealthy()
})

test('landing page links to signup, privacy, and terms', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('a[href="/signup"]:visible').first()).toBeVisible()
  await expect(page.locator('a[href="/privacy"]:visible').first()).toBeVisible()
  await expect(page.locator('a[href="/terms"]:visible').first()).toBeVisible()
})
