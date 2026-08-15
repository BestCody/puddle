import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

async function changedPixelRatio(referencePath, screenshotBuffer) {
  const reference = await sharp(referencePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const screenshot = await sharp(screenshotBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  expect([screenshot.info.width, screenshot.info.height]).toEqual([reference.info.width, reference.info.height])
  let changed = 0
  const pixels = reference.info.width * reference.info.height
  for (let offset = 0; offset < reference.data.length; offset += 4) {
    if (reference.data[offset] !== screenshot.data[offset] || reference.data[offset + 1] !== screenshot.data[offset + 1] || reference.data[offset + 2] !== screenshot.data[offset + 2] || reference.data[offset + 3] !== screenshot.data[offset + 3]) changed += 1
  }
  return changed / pixels
}

test('production desktop landing is a genuine implementation of Figma 83:76', async ({ page }) => {
  await page.setViewportSize({ width: 1281, height: 900 })
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts?.ready)
  await page.waitForFunction(() => document.querySelector('.landing-stage--desktop')?.dataset.ready === 'true')

  await expect(page.locator('[data-figma-node="83:76"]')).toBeVisible()
  await expect(page.locator('[data-figma-node="161:116"]')).not.toBeVisible()
  await expect(page.locator('img[src="/figma/landing-desktop.png"]')).toHaveCount(0)
  await expect(page.locator('img[src="/figma/landing-mobile.png"]')).toHaveCount(0)
  await expect(page.locator('.login-panel input')).toHaveCount(2)
  await expect(page.locator('.feature-card--d-swipe')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  const screenshot = await page.screenshot({ fullPage: true })
  const ratio = await changedPixelRatio(join(root, 'public/figma/landing-desktop.png'), screenshot)
  expect(ratio).toBeLessThan(0.35)

  await page.locator('.safety-panel--desktop [data-open-safety]').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.locator('.landing-canvas--desktop a[href="/signin"]').first().click()
  await expect(page).toHaveURL(/\/signin(?:\?|$)/)
})

test('production mobile landing is a genuine implementation of Figma 161:116', async ({ page }) => {
  await page.setViewportSize({ width: 704, height: 900 })
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts?.ready)
  await page.waitForFunction(() => document.querySelector('.landing-stage--mobile')?.dataset.ready === 'true')

  await expect(page.locator('[data-figma-node="161:116"]')).toBeVisible()
  await expect(page.locator('[data-figma-node="83:76"]')).not.toBeVisible()
  await expect(page.locator('img[src="/figma/landing-desktop.png"]')).toHaveCount(0)
  await expect(page.locator('img[src="/figma/landing-mobile.png"]')).toHaveCount(0)
  await expect(page.locator('.mobile-jump')).toBeVisible()
  await expect(page.locator('.feature-card--m-swipe')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  const screenshot = await page.screenshot({ fullPage: true })
  const ratio = await changedPixelRatio(join(root, 'public/figma/landing-mobile.png'), screenshot)
  expect(ratio).toBeLessThan(0.35)

  await page.locator('.final-cta--mobile a[href="/signup"]').click()
  await expect(page).toHaveURL(/\/signup(?:\?|$)/)
})
