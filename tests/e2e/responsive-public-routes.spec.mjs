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

async function exposeHeaderActions(page) {
  const menu = page.getByRole('button', { name: 'Open menu' })
  if (await menu.isVisible()) await menu.click()
  await expect(page.locator('.header-actions')).toBeVisible()
}

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

test('landing page exposes native auth and legal links', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('a[href="/signin"]')).not.toHaveCount(0)
  await expect(page.locator('a[href="/signup"]')).not.toHaveCount(0)
  await expect(page.locator('a[href="/privacy"]')).not.toHaveCount(0)
  await expect(page.locator('a[href="/terms"]')).not.toHaveCount(0)
  await expect(page.locator('button[data-open-app]')).toHaveCount(0)
  await expect(page.locator('[data-open-modal="waitlist"]')).toHaveCount(0)
})

test('header Sign In and Register links reach the real auth pages', async ({ page }) => {
  await page.goto('/')
  await exposeHeaderActions(page)
  await page.locator('.header-actions a[href="/signin"]').click()
  await expect(page).toHaveURL(/\/signin(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'Jump back into your Puddle.', level: 1 })).toBeVisible()

  await page.goto('/')
  await exposeHeaderActions(page)
  await page.locator('.header-actions a[href="/signup"]').click()
  await expect(page).toHaveURL(/\/signup(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'Make plans that leave the chat.', level: 1 })).toBeVisible()
})

test('footer registration form submits directly to signup', async ({ page }) => {
  await page.goto('/')
  await page.locator('.footer-form input[name="email"]').fill('landing-route@example.com')
  await page.locator('.footer-form button[type="submit"]').click()
  await expect(page).toHaveURL(/\/signup\?email=landing-route%40example\.com$/)
  await expect(page.locator('input[name="email"]')).toHaveValue('landing-route@example.com')
})

test('critical landing routes work when JavaScript is disabled', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One no-JavaScript route pass is sufficient')
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    javaScriptEnabled: false,
    viewport: { width: 1280, height: 900 }
  })
  const page = await context.newPage()

  await page.goto('/')
  await expect(page.locator('.hero-copy')).toBeVisible()
  await expect(page.locator('#hero-deck .event-card')).toHaveCount(3)
  await page.locator('.hero-actions a[href="/signin"]').click()
  await expect(page).toHaveURL(/\/signin(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'Jump back into your Puddle.', level: 1 })).toBeVisible()

  await page.goto('/')
  await page.locator('.hero-actions a[href="/signup"]').click()
  await expect(page).toHaveURL(/\/signup(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'Make plans that leave the chat.', level: 1 })).toBeVisible()

  await context.close()
})
