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

function expectedLandingMode(width) {
  return width <= 760 ? 'mobile' : 'desktop'
}

async function visibleLandingArtboard(page) {
  const width = await page.evaluate(() => window.innerWidth)
  const mode = expectedLandingMode(width)
  const selector = `.figma-artboard--${mode}`
  await expect(page.locator(selector)).toBeVisible()
  await expect(page.locator(mode === 'desktop' ? '.figma-artboard--mobile' : '.figma-artboard--desktop')).not.toBeVisible()
  return { mode, selector, width }
}

for (const [path, heading] of publicPages) {
  test(`${path} renders without frontend failures or horizontal overflow`, async ({ page }, testInfo) => {
    const health = trackFrontendHealth(page, {
      baseURL: testInfo.project.use.baseURL,
      strictConsole: path !== '/'
    })

    await page.goto(path)
    if (path === '/') await visibleLandingArtboard(page)
    else await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()

    await assertImagesLoaded(page)
    await assertNoHorizontalOverflow(page)
    health.assertHealthy()
  })
}

test('landing page preserves the exact Figma desktop and mobile artboard structure', async ({ page }, testInfo) => {
  const health = trackFrontendHealth(page, { baseURL: testInfo.project.use.baseURL, strictConsole: false })
  await page.goto('/')
  const { mode, selector, width } = await visibleLandingArtboard(page)
  const height = await page.evaluate(() => window.innerHeight)

  const metrics = await page.locator(selector).evaluate((node) => {
    const image = node.querySelector('img')
    const rect = node.getBoundingClientRect()
    const imageRect = image.getBoundingClientRect()
    return {
      artboardWidth: rect.width,
      imageWidth: imageRect.width,
      imageHeight: imageRect.height,
      left: rect.left,
      right: document.documentElement.clientWidth - rect.right,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight
    }
  })

  if (mode === 'desktop') {
    expect(await page.locator('[data-figma-node="83:76"]').isVisible()).toBe(true)
    expect(metrics.naturalWidth).toBe(1281)
    expect(metrics.naturalHeight).toBe(8736)
    expect(metrics.artboardWidth).toBeCloseTo(Math.min(width, 1281, height * 1.425), 0)
    expect(metrics.artboardWidth).toBeLessThanOrEqual(1281.5)
  } else {
    expect(await page.locator('[data-figma-node="161:116"]').isVisible()).toBe(true)
    expect(metrics.naturalWidth).toBe(704)
    expect(metrics.naturalHeight).toBe(9660)
    expect(metrics.artboardWidth).toBeCloseTo(Math.min(width, 704), 0)
    expect(metrics.artboardWidth).toBeLessThanOrEqual(704.5)
  }

  expect(metrics.imageWidth).toBeCloseTo(metrics.artboardWidth, 0)
  expect(metrics.imageHeight / metrics.imageWidth).toBeCloseTo(metrics.naturalHeight / metrics.naturalWidth, 3)
  expect(Math.abs(metrics.left - metrics.right)).toBeLessThanOrEqual(1)

  for (const path of ['/signin', '/signup', '/privacy', '/terms']) {
    expect(await page.locator(`${selector} a[href="${path}"]`).count()).toBeGreaterThan(0)
  }

  await assertImagesLoaded(page)
  await assertNoHorizontalOverflow(page)
  health.assertHealthy()
})

test('landing safety modal and Figma navigation hotspot work', async ({ page }) => {
  await page.goto('/')
  const { mode, selector } = await visibleLandingArtboard(page)

  await page.locator(`${selector} button[data-open-safety]`).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Puddle is built on trust and privacy', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).not.toBeVisible()

  await page.locator(`${selector} a[aria-label="Open navigation"]`).click()
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(mode === 'desktop' ? '#footer-links-d' : '#footer-links-m')
})

test('landing page exposes native auth and legal links', async ({ page }) => {
  await page.goto('/')
  const { selector } = await visibleLandingArtboard(page)
  for (const path of ['/signin', '/signup', '/privacy', '/terms']) {
    expect(await page.locator(`${selector} a[href="${path}"]`).count()).toBeGreaterThan(0)
  }
  await expect(page.locator('button[data-open-app]')).toHaveCount(0)
  await expect(page.locator('[data-open-modal="waitlist"]')).toHaveCount(0)
})

test('landing auth hotspots reach the real auth pages', async ({ page }) => {
  await page.goto('/')
  let { selector } = await visibleLandingArtboard(page)
  await page.locator(`${selector} a[href="/signin"]`).first().click()
  await expect(page).toHaveURL(/\/signin(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'Discover places. See who’s there.', level: 1 })).toBeVisible()

  await page.goto('/')
  ;({ selector } = await visibleLandingArtboard(page))
  await page.locator(`${selector} a[href="/signup"]`).first().click()
  await expect(page).toHaveURL(/\/signup(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'Make plans that leave the chat.', level: 1 })).toBeVisible()
})

test('Figma 404 gives the user a working route home', async ({ page }) => {
  await page.goto('/this-puddle-does-not-exist')
  await expect(page.getByRole('heading', { name: 'This puddle dried up.' })).toBeVisible()
  await expect(page.getByText('404', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Back to Puddle' }).click()
  await expect(page).toHaveURL(/\/$/)
  await visibleLandingArtboard(page)
})

test('critical landing auth routes work when JavaScript is disabled', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One no-JavaScript route pass is sufficient')
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    javaScriptEnabled: false,
    viewport: { width: 1280, height: 900 }
  })
  const page = await context.newPage()

  await page.goto('/')
  await expect(page.locator('.figma-artboard--desktop')).toBeVisible()
  await expect(page.locator('.figma-artboard--desktop img')).toBeVisible()
  await page.locator('.figma-artboard--desktop a[href="/signin"]').first().click()
  await expect(page).toHaveURL(/\/signin(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'Discover places. See who’s there.', level: 1 })).toBeVisible()

  await page.goto('/')
  await page.locator('.figma-artboard--desktop a[href="/signup"]').first().click()
  await expect(page).toHaveURL(/\/signup(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'Make plans that leave the chat.', level: 1 })).toBeVisible()

  await context.close()
})
