import { test, expect } from '@playwright/test'
import { assertNoHorizontalOverflow } from './support.mjs'
import { assertImagesLoaded, trackFrontendHealth } from './frontend-health.mjs'

const publicPages = [
  ['/', null],
  ['/signin', 'Discover places. See who’s there.'],
  ['/signup', 'Make plans that leave the chat.'],
  ['/privacy', 'Privacy Policy'],
  ['/terms', 'Terms of Service']
]

function expectedLandingMode(width) { return width <= 760 ? 'mobile' : 'desktop' }
function landingAuthRoot(mode) { return mode === 'desktop' ? '.landing-sticky-left' : '.landing-canvas--mobile' }

async function visibleLandingCanvas(page) {
  const width = await page.evaluate(() => window.innerWidth)
  const mode = expectedLandingMode(width)
  const stage = `.landing-stage--${mode}`
  const selector = `.landing-canvas--${mode}`
  await page.waitForFunction((stageSelector) => document.querySelector(stageSelector)?.dataset.ready === 'true', stage)
  await expect(page.locator(stage)).toBeVisible()
  await expect(page.locator(mode === 'desktop' ? '.landing-stage--mobile' : '.landing-stage--desktop')).not.toBeVisible()
  await expect(page.locator(selector)).toBeVisible()
  if (mode === 'desktop') await expect(page.locator('.landing-sticky-left')).toBeVisible()
  return { mode, stage, selector, authRoot: landingAuthRoot(mode) }
}

for (const [path, heading] of publicPages) {
  test(`${path} renders without frontend failures or horizontal overflow`, async ({ page }, testInfo) => {
    const health = trackFrontendHealth(page, { baseURL: testInfo.project.use.baseURL, strictConsole: path !== '/' })
    await page.goto(path)
    if (path === '/') await visibleLandingCanvas(page)
    else await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
    await assertImagesLoaded(page)
    await assertNoHorizontalOverflow(page)
    health.assertHealthy()
  })
}

test('landing page uses the correct responsive composition and real DOM content', async ({ page }, testInfo) => {
  const health = trackFrontendHealth(page, { baseURL: testInfo.project.use.baseURL, strictConsole: false })
  await page.goto('/')
  const { mode, selector, authRoot } = await visibleLandingCanvas(page)

  if (mode === 'desktop') {
    await expect(page.locator('[data-figma-node="83:76"]')).toBeVisible()
    await expect(page.locator('.landing-sticky-left .login-panel input')).toHaveCount(2)
    await expect(page.locator('.landing-sticky-left')).toHaveAttribute('data-footer-suspended', 'false')
    await expect(page.locator('.feature-card--d-swipe')).toBeVisible()
  } else {
    await expect(page.locator('[data-figma-node="161:116"]')).toBeVisible()
    await expect(page.locator('.mobile-jump')).toBeVisible()
    await expect(page.locator('.feature-card--m-swipe')).toBeVisible()
    await expect(page.locator('.landing-sticky-left')).not.toBeVisible()
  }

  await expect(page.locator('img[src="/figma/landing-desktop.png"]')).toHaveCount(0)
  await expect(page.locator('img[src="/figma/landing-mobile.png"]')).toHaveCount(0)
  await expect(page.locator('.interactive-pill')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Discover places. See who’s there.', level: 1 })).toBeVisible()

  for (const path of ['/signin', '/signup']) expect(await page.locator(`${authRoot} a[href="${path}"]`).count()).toBeGreaterThan(0)
  for (const path of ['/privacy', '/terms']) expect(await page.locator(`${selector} a[href="${path}"]`).count()).toBeGreaterThan(0)
  await assertImagesLoaded(page)
  await assertNoHorizontalOverflow(page)
  health.assertHealthy()
})

test('desktop landing releases the sticky sign-in pane for the full-width footer and restores it above the footer', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop sticky-footer behavior only')

  await page.goto('/')
  await visibleLandingCanvas(page)
  const sticky = page.locator('.landing-sticky-left')
  const footer = page.locator('#footer-d')

  await expect(sticky).toHaveAttribute('data-footer-suspended', 'false')
  await expect(sticky).toHaveAttribute('aria-hidden', 'false')

  await footer.scrollIntoViewIfNeeded()
  await expect(footer).toBeVisible()
  await expect(sticky).toHaveAttribute('data-footer-suspended', 'true')
  await expect(sticky).toHaveAttribute('aria-hidden', 'true')
  for (const label of ['Explore', 'Company', 'Connect']) {
    await expect(footer.getByText(label, { exact: true })).toBeVisible()
  }

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await expect(sticky).toHaveAttribute('data-footer-suspended', 'false')
  await expect(sticky).toHaveAttribute('aria-hidden', 'false')
})

test('landing safety modal and navigation work', async ({ page }) => {
  await page.goto('/')
  const { mode, selector } = await visibleLandingCanvas(page)
  await page.locator(`${selector} button[data-open-safety]`).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Puddle is built on trust and privacy', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.locator(`${selector} a[aria-label="Open navigation"]`).click()
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(mode === 'desktop' ? '#footer-d' : '#footer-m')
})

test('landing exposes real auth and legal links', async ({ page }) => {
  await page.goto('/')
  const { selector, authRoot } = await visibleLandingCanvas(page)
  for (const path of ['/signin', '/signup']) expect(await page.locator(`${authRoot} a[href="${path}"]`).count()).toBeGreaterThan(0)
  for (const path of ['/privacy', '/terms']) expect(await page.locator(`${selector} a[href="${path}"]`).count()).toBeGreaterThan(0)
  await expect(page.locator('button[data-open-app]')).toHaveCount(0)
  await expect(page.locator('[data-open-modal="waitlist"]')).toHaveCount(0)
})

test('landing auth controls reach the real auth pages', async ({ page }) => {
  await page.goto('/')
  let { authRoot } = await visibleLandingCanvas(page)
  await page.locator(`${authRoot} a[href="/signin"]`).first().click()
  await expect(page).toHaveURL(/\/signin(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'Discover places. See who’s there.', level: 1 })).toBeVisible()

  await page.goto('/')
  ;({ authRoot } = await visibleLandingCanvas(page))
  await page.locator(`${authRoot} a[href="/signup"]`).first().click()
  await expect(page).toHaveURL(/\/signup(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'Make plans that leave the chat.', level: 1 })).toBeVisible()
})

test('404 gives the user a working route home', async ({ page }) => {
  await page.goto('/this-puddle-does-not-exist')
  await expect(page.getByRole('heading', { name: 'This puddle dried up.' })).toBeVisible()
  await expect(page.getByText('404', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Back to Puddle' }).click()
  await expect(page).toHaveURL(/\/$/)
  await visibleLandingCanvas(page)
})
