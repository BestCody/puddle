import { test, expect } from '@playwright/test'

test('production desktop landing preserves the current responsive Figma structure', async ({ page }) => {
  await page.setViewportSize({ width: 1281, height: 900 })
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts?.ready)
  await page.waitForFunction(() => document.querySelector('.landing-stage--desktop')?.dataset.ready === 'true')

  await expect(page.locator('[data-figma-node="352:484"]')).toBeVisible()
  await expect(page.locator('[data-figma-node="351:156"]')).not.toBeVisible()
  await expect(page.locator('img[src="/figma/landing-desktop.png"]')).toHaveCount(0)
  await expect(page.locator('img[src="/figma/landing-mobile.png"]')).toHaveCount(0)
  await expect(page.locator('.login-panel form.landing-login-form input:not([type="hidden"])')).toHaveCount(2)
  await expect(page.locator('.feature-card--d-swipe')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  await expect(page.locator('.safety-panel--desktop h2')).toHaveText('Over 30 million locations worldwide')
  await expect(page.locator('.safety-panel--desktop .safety-post')).toHaveCount(4)
  await expect(page.locator('.safety-panel--desktop .safety-model-button')).toHaveAttribute('href', '/places')

  await expect(page.locator('.login-panel form.landing-login-form')).toHaveAttribute('action', '/api/auth/password')
  await expect(page.locator('.login-panel a[href="/api/auth/google?next=%2Fdiscover"]')).toHaveAttribute('aria-label', 'Continue with Google')
})

test('production mobile landing preserves the current responsive Figma structure', async ({ page }) => {
  await page.setViewportSize({ width: 704, height: 900 })
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts?.ready)
  await page.waitForFunction(() => document.querySelector('.landing-stage--mobile')?.dataset.ready === 'true')

  await expect(page.locator('[data-figma-node="351:156"]')).toBeVisible()
  await expect(page.locator('[data-figma-node="352:484"]')).not.toBeVisible()
  await expect(page.locator('img[src="/figma/landing-desktop.png"]')).toHaveCount(0)
  await expect(page.locator('img[src="/figma/landing-mobile.png"]')).toHaveCount(0)
  await expect(page.locator('.feature-card--m-swipe')).toBeVisible()
  await expect(page.locator('.feature-card--m-profile')).toHaveCount(0)
  await expect(page.locator('.mobile-login-button')).toHaveAttribute('href', '/signin')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  await page.locator('.final-cta--mobile a[href="/signup"]').click()
  await expect(page).toHaveURL(/\/signup(?:\?|$)/)
})
