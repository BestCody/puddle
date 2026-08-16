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
  return { mode, stage, selector, authRoot: landingAuthRoot(mode), width }
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

test('landing page is real responsive frontend composed from the Figma design', async ({ page }, testInfo) => {
  const health = trackFrontendHealth(page, { baseURL: testInfo.project.use.baseURL, strictConsole: false })
  await page.goto('/')
  const { mode, stage, selector, authRoot, width } = await visibleLandingCanvas(page)
  const height = await page.evaluate(() => window.innerHeight)

  const metrics = await page.locator(stage).evaluate((node) => {
    const canvas = node.querySelector('.landing-canvas')
    const rect = node.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    return { stageWidth: rect.width, stageHeight: rect.height, canvasWidth: canvasRect.width, canvasHeight: canvasRect.height, left: rect.left, right: document.documentElement.clientWidth - rect.right }
  })

  if (mode === 'desktop') {
    expect(await page.locator('[data-figma-node="83:76"]').isVisible()).toBe(true)
    expect(metrics.stageWidth).toBeCloseTo(Math.min(width, 1281, height * 1.425), 0)
    expect(metrics.stageWidth).toBeLessThanOrEqual(1281.5)
    await expect(page.locator('.landing-sticky-left .login-panel input')).toHaveCount(2)
    await expect(page.locator('.feature-card--d-swipe')).toBeVisible()
  } else {
    expect(await page.locator('[data-figma-node="161:116"]').isVisible()).toBe(true)
    expect(metrics.stageWidth).toBeCloseTo(Math.min(width, 704), 0)
    expect(metrics.stageWidth).toBeLessThanOrEqual(704.5)
    await expect(page.locator('.mobile-jump')).toBeVisible()
    await expect(page.locator('.feature-card--m-swipe')).toBeVisible()
  }

  expect(metrics.canvasWidth).toBeCloseTo(metrics.stageWidth, 0)
  expect(metrics.canvasHeight / metrics.canvasWidth).toBeCloseTo(mode === 'desktop' ? 7578 / 1281 : 9660 / 704, 3)
  expect(Math.abs(metrics.left - metrics.right)).toBeLessThanOrEqual(1)
  expect(await page.locator('img[src="/figma/landing-desktop.png"]').count()).toBe(0)
  expect(await page.locator('img[src="/figma/landing-mobile.png"]').count()).toBe(0)
  await expect(page.getByRole('heading', { name: 'Discover places. See who’s there.', level: 1 })).toBeVisible()

  for (const path of ['/signin', '/signup']) expect(await page.locator(`${authRoot} a[href="${path}"]`).count()).toBeGreaterThan(0)
  for (const path of ['/privacy', '/terms']) expect(await page.locator(`${selector} a[href="${path}"]`).count()).toBeGreaterThan(0)
  await assertImagesLoaded(page)
  await assertNoHorizontalOverflow(page)
  health.assertHealthy()
})

test('landing safety modal and Figma navigation work', async ({ page }) => {
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

test('Figma 404 gives the user a working route home', async ({ page }) => {
  await page.goto('/this-puddle-does-not-exist')
  await expect(page.getByRole('heading', { name: 'This puddle dried up.' })).toBeVisible()
  await expect(page.getByText('404', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Back to Puddle' }).click()
  await expect(page).toHaveURL(/\/$/)
  await visibleLandingCanvas(page)
})
