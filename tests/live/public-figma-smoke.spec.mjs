import { test, expect } from '@playwright/test'

test('production desktop landing preserves the current responsive Figma structure', async ({ page }) => {
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

  await page.locator('.safety-panel--desktop [data-open-safety]').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.locator('.landing-canvas--desktop a[href="/signin"]').first().click()
  await expect(page).toHaveURL(/\/signin(?:\?|$)/)
})

test('production mobile landing preserves the current responsive Figma structure and scroll reveal', async ({ page }) => {
  await page.setViewportSize({ width: 704, height: 900 })
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts?.ready)
  await page.waitForFunction(() => document.querySelector('.landing-stage--mobile')?.dataset.ready === 'true')

  await expect(page.locator('[data-figma-node="161:116"]')).toBeVisible()
  await expect(page.locator('[data-figma-node="83:76"]')).not.toBeVisible()
  await expect(page.locator('img[src="/figma/landing-desktop.png"]')).toHaveCount(0)
  await expect(page.locator('img[src="/figma/landing-mobile.png"]')).toHaveCount(0)
  const jump = page.locator('.mobile-jump')
  await expect(jump).toHaveCSS('visibility', 'hidden')
  await expect(jump).toHaveCSS('opacity', '0')
  await expect(page.locator('.feature-card--m-swipe')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  await page.evaluate(() => window.scrollTo({ top: 24, behavior: 'instant' }))
  await expect(jump).toBeVisible()
  await expect(jump).toHaveCSS('opacity', '1')

  await page.locator('.final-cta--mobile a[href="/signup"]').click()
  await expect(page).toHaveURL(/\/signup(?:\?|$)/)
})
