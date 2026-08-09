import { test, expect } from '@playwright/test'

test('retired group swipe API is unavailable', async ({ request }) => {
  const response = await request.post('/api/date-match/action', { data: {} })
  expect(response.status()).toBe(410)
  await expect(response.json()).resolves.toMatchObject({ error: /retired/i })
})

test('retired group swipe links leave the old experience', async ({ page }) => {
  await page.goto('/hangout/retired-link')
  await expect(page).not.toHaveURL(/\/hangout\//)
})
