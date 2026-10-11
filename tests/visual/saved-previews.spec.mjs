import { test, expect } from '@playwright/test'

test('Saved remains usable without a preview endpoint, including before hydration', async ({ page, context }) => {
  const requests = []
  await context.route('**/api/saved-location-options*', (route) => {
    requests.push(route.request().url())
    return route.abort()
  })
  const response = await page.goto('/plans')
  const html = await response.text()
  expect(html).toContain('Maple Grove Park')
  expect(html).toContain('/plans/visual-place-0')
  const cards = page.getByTestId('saved-card')
  await expect(cards).toHaveCount(12)
  await expect(cards.last().locator('h2 a')).toHaveAttribute('href', '/plans/visual-place-11')
  await cards.last().scrollIntoViewIfNeeded()
  expect(requests).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await cards.first().locator('h2 a').click()
  await expect(page.getByRole('dialog')).toBeVisible()
})
