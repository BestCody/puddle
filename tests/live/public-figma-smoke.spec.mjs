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
    if (reference.data[offset] !== screenshot.data[offset] ||
        reference.data[offset + 1] !== screenshot.data[offset + 1] ||
        reference.data[offset + 2] !== screenshot.data[offset + 2] ||
        reference.data[offset + 3] !== screenshot.data[offset + 3]) changed += 1
  }
  return changed / pixels
}

test('production desktop landing is the exact Figma 83:76 artboard', async ({ page }) => {
  await page.setViewportSize({ width: 1281, height: 900 })
  await page.goto('/', { waitUntil: 'networkidle' })

  const desktop = page.locator('[data-figma-node="83:76"]')
  await expect(desktop).toBeVisible()
  await expect(page.locator('[data-figma-node="161:116"]')).not.toBeVisible()
  await expect(page.locator('.figma-artboard--desktop img')).toHaveJSProperty('naturalWidth', 1281)
  await expect(page.locator('.figma-artboard--desktop img')).toHaveJSProperty('naturalHeight', 8736)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  const screenshot = await page.screenshot({ fullPage: true })
  const ratio = await changedPixelRatio(join(root, 'public/figma/landing-desktop.png'), screenshot)
  expect(ratio).toBeLessThan(0.0001)

  await page.locator('.d-safety-button').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.locator('.d-signin-email').click()
  await expect(page).toHaveURL(/\/signin(?:\?|$)/)
})

test('production mobile landing is the exact Figma 161:116 artboard', async ({ page }) => {
  await page.setViewportSize({ width: 704, height: 900 })
  await page.goto('/', { waitUntil: 'networkidle' })

  const mobile = page.locator('[data-figma-node="161:116"]')
  await expect(mobile).toBeVisible()
  await expect(page.locator('[data-figma-node="83:76"]')).not.toBeVisible()
  await expect(page.locator('.figma-artboard--mobile img')).toHaveJSProperty('naturalWidth', 704)
  await expect(page.locator('.figma-artboard--mobile img')).toHaveJSProperty('naturalHeight', 9660)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  await expect(page.locator('.mobile-jump-mask')).toHaveCSS('opacity', '1')
  await page.evaluate(() => window.scrollTo(0, 1))
  await page.waitForTimeout(350)
  await expect(mobile).toHaveClass(/has-scrolled/)

  const screenshot = await page.screenshot({ fullPage: true })
  const ratio = await changedPixelRatio(join(root, 'public/figma/landing-mobile.png'), screenshot)
  expect(ratio).toBeLessThan(0.0001)

  await page.locator('.m-create-account').click()
  await expect(page).toHaveURL(/\/signup(?:\?|$)/)
})
