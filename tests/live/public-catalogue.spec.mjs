import { expect, test } from '@playwright/test'

test('public catalogue city and place pages serve real listings', async ({ page }) => {
  const response = await page.goto('/places/in/toronto', { waitUntil: 'domcontentloaded' })
  expect(response?.status(), 'Toronto city page must render').toBe(200)
  await expect(page.locator('.place-hub-card').first()).toBeVisible()
  const placeHref = await page.locator('.place-hub-card a').first().getAttribute('href')
  expect(placeHref).toMatch(/^\/places\/[^/]+$/)

  const placeResponse = await page.goto(placeHref, { waitUntil: 'domcontentloaded' })
  expect(placeResponse?.status(), 'linked public place must render').toBe(200)

  for (const path of ['/places/in/toronto/coffee-shops', '/date-ideas/toronto']) {
    const relatedResponse = await page.goto(path, { waitUntil: 'domcontentloaded' })
    expect(relatedResponse?.status(), `${path} must render`).toBe(200)
    await expect(page.locator('main h1').first()).toBeVisible()
  }
})
