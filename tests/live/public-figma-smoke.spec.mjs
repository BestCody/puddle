import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

async function normalizedMae(referencePath, screenshotBuffer) {
  const reference = await sharp(referencePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const screenshot = await sharp(screenshotBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  expect([screenshot.info.width, screenshot.info.height]).toEqual([reference.info.width, reference.info.height])
  let absoluteError = 0
  const pixels = reference.info.width * reference.info.height
  for (let offset = 0; offset < reference.data.length; offset += 4) {
    for (let channel = 0; channel < 4; channel += 1) absoluteError += Math.abs(reference.data[offset + channel] - screenshot.data[offset + channel])
  }
  return absoluteError / (pixels * 4 * 255)
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
  expect(await normalizedMae(join(root, 'public/figma/landing-desktop.png'), screenshot)).toBeLessThan(0.03)

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
  expect(await normalizedMae(join(root, 'public/figma/landing-mobile.png'), screenshot)).toBeLessThan(0.035)

  await page.locator('.final-cta--mobile a[href="/signup"]').click()
  await expect(page).toHaveURL(/\/signup(?:\?|$)/)
})
