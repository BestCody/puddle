import { test, expect } from '@playwright/test'

test('production public Figma landing and auth routes work interactively', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.hero-copy h1')).toContainText('Discover places.')
  await expect(page.locator('.phone-shell')).toBeVisible()
  await expect(page.locator('#hero-deck .event-card')).toHaveCount(3)

  const firstTitle = await page.locator('#hero-deck .event-card:last-child h3').innerText()
  await page.getByRole('button', { name: 'Pass', exact: true }).click()
  await expect.poll(async () => page.locator('#hero-deck .event-card:last-child h3').innerText()).not.toBe(firstTitle)
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.locator('#hero-deck .event-card:last-child h3')).toHaveText(firstTitle)
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

  await page.locator('.hero-login a[href="/signin"]').first().click()
  await expect(page).toHaveURL(/\/signin(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'Discover places. See who’s there.', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible()

  await page.goto('/')
  await page.locator('.hero-login a[href="/signup"]').click()
  await expect(page).toHaveURL(/\/signup(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'Make plans that leave the chat.', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create my Puddle →', exact: true })).toBeVisible()
})
