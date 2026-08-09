import { test, expect } from '@playwright/test'

test('retired pair swipe API is unavailable', async ({ request }) => {
  const response = await request.post('/api/date-match/start', { data: {} })
  expect(response.status()).toBe(410)
  await expect(response.json()).resolves.toMatchObject({ error: /retired/i })
})

test('retired pair swipe links leave the old experience', async ({ page }) => {
  await page.goto('/date-match/retired-link')
  await expect(page).not.toHaveURL(/\/date-match\//)
})
