import { test, expect } from '@playwright/test'
import { assertNoHorizontalOverflow } from './support.mjs'
import { assertImagesLoaded, trackFrontendHealth } from './frontend-health.mjs'

const publicPages = [
  ['/', 'Discover places.'],
  ['/signin', 'Discover places. See who’s there.'],
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
    if (path === '/') await expect(page.locator('.hero-copy h1')).toContainText(heading)
    else await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()

    await assertImagesLoaded(page)
    await assertNoHorizontalOverflow(page)
    health.assertHealthy()
  })
}

test('landing page preserves the official Figma desktop and mobile structure', async ({ page }, testInfo) => {
  const health = trackFrontendHealth(page, { baseURL: testInfo.project.use.baseURL, strictConsole: true })
  await page.goto('/')
  for (const selector of ['.site-header','.hero-copy h1','.hero-playground','.phone-shell','#hero-deck','#how','#safety','.final-cta','.site-footer']) {
    await expect(page.locator(selector)).toBeVisible()
  }
  await expect(page.locator('#hero-deck .event-card')).toHaveCount(3)
  await expect(page.getByRole('link', { name: 'Create account', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible()

  const layout = await page.evaluate(() => {
    const box = (selector) => {
      const element = document.querySelector(selector)
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    return { viewportWidth: innerWidth, hero: box('.hero-copy'), phone: box('.phone-shell'), featureCards: document.querySelectorAll('.feature-card').length }
  })
  expect(layout.featureCards).toBe(4)
  expect(layout.phone?.width || 0).toBeGreaterThanOrEqual(260)
  expect(layout.phone?.height || 0).toBeGreaterThan(480)
  if (layout.viewportWidth >= 768) expect(layout.hero?.x || 0).toBeLessThan(layout.phone?.x || Infinity)
  else expect(layout.hero?.y || 0).toBeLessThan(layout.phone?.y || Infinity)

  await assertImagesLoaded(page)
  await assertNoHorizontalOverflow(page)
  health.assertHealthy()
})

test('landing Figma swipe, safety modal, and menu controls work', async ({ page }) => {
  await page.goto('/')
  const topCardTitle = page.locator('#hero-deck .event-card:last-child h3')
  const firstTitle = await topCardTitle.innerText()

  await page.getByRole('button', { name: 'Pass', exact: true }).click()
  await expect.poll(async () => topCardTitle.innerText()).not.toBe(firstTitle)
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(topCardTitle).toHaveText(firstTitle)
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Star', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'See our safety model', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Shared places first. Privacy controls always.', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('button', { name: 'Open menu', exact: true }).click()
  await expect(page.locator('.header-actions a[href="/signin"]')).toBeVisible()
  await expect(page.locator('.header-actions a[href="/signup"]')).toBeVisible()
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

test('header Sign in and Create account links reach the real auth pages', async ({ page }) => {
  await page.goto('/')
  await exposeHeaderActions(page)
  await page.locator('.header-actions a[href="/signin"]').click()
  await expect(page).toHaveURL(/\/signin(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'Discover places. See who’s there.', level: 1 })).toBeVisible()

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

test('Figma 404 gives the user a working route home', async ({ page }) => {
  await page.goto('/this-puddle-does-not-exist')
  await expect(page.getByRole('heading', { name: 'This puddle dried up.' })).toBeVisible()
  await expect(page.getByText('404', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Back to Puddle' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('.hero-copy h1')).toContainText('Discover places.')
})

test('critical landing routes work when JavaScript is disabled', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One no-JavaScript route pass is sufficient')
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, javaScriptEnabled: false, viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()

  await page.goto('/')
  await expect(page.locator('.hero-copy')).toBeVisible()
  await expect(page.locator('#hero-deck .event-card')).toHaveCount(3)
  await page.locator('.hero-login a[href="/signin"]').first().click()
  await expect(page).toHaveURL(/\/signin(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'Discover places. See who’s there.', level: 1 })).toBeVisible()

  await page.goto('/')
  await page.locator('.hero-login a[href="/signup"]').click()
  await expect(page).toHaveURL(/\/signup(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'Make plans that leave the chat.', level: 1 })).toBeVisible()

  await context.close()
})
