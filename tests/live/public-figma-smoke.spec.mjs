import { test, expect } from '@playwright/test'

test('production public Figma landing and auth routes work interactively', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.hero-copy h1')).toContainText('Discover places.')
  await expect(page.locator('.phone-shell')).toBeVisible()
  await expect(page.locator('#hero-deck .event-card')).toHaveCount(3)

  const firstTitle = await page.locator('#hero-deck .event-card:last-child h3').innerText()
  await page.getByRole('button', { name: 'Pass' }).click()
  await expect.poll(async () => page.locator('#hero-deck .event-card:last-child h3').innerText()).not.toBe(firstTitle)
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.locator('#hero-deck .event-card:last-child h3')).toHaveText(firstTitle)
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Star' })).toBeVisible()

  await page.getByRole('button', { name: 'See our safety model' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Shared places first. Privacy controls always.' })).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('button', { name: 'Open menu' }).click()
  await expect(page.locator('.header-actions a[href="/signin"]')).toBeVisible()
  await expect(page.locator('.header-actions a[href="/signup"]')).toBeVisible()

  await page.locator('.hero-login a[href="/signin"]').first().click()
  await expect(page).toHaveURL(/\/signin(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'Discover places. See who’s there.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()

  await page.goto('/')
  await page.locator('.hero-login a[href="/signup"]').click()
  await expect(page).toHaveURL(/\/signup(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'Make plans that leave the chat.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create my Puddle →' })).toBeVisible()
})
