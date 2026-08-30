import { test, expect } from '@playwright/test'

test('public legal pages advertise CDN caching while security tokens do not', async ({ request }) => {
  const legal = await request.get('/privacy')
  expect(legal.headers()['cache-control']).toContain('s-maxage=3600')
  const token = await request.get('/api/security/csrf')
  expect(token.headers()['cache-control']).toContain('no-store')
})

test('mutating APIs reject requests without a CSRF token', async ({ request }) => {
  const response = await request.post('/api/geocode', { data: { address: 'Toronto' } })
  expect(response.status()).toBe(403)
  await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/security token/i) })
})

test('the retired sign-in route is no longer served', async ({ request }) => {
  const response = await request.get('/signin')
  expect(response.status()).toBe(404)
})

test('callback provider failures return a useful sign-in message', async ({ page }) => {
  await page.goto('/auth/callback?error=access_denied&error_description=cancelled')
  await expect(page).toHaveURL(/\/\?.*auth_error=access_denied/)
  const visibleAuthMessage = page.locator('.landing-auth-message:visible').filter({ hasText: /cancelled|not approved/i })
  await expect(visibleAuthMessage).toHaveCount(1)
  await expect(visibleAuthMessage).toBeVisible()
  await expect(page).not.toHaveURL(/\/auth\/error/)
})

test('missing callback codes do not expose a generic error page', async ({ page }) => {
  await page.goto('/auth/callback?next=/onboarding')
  await expect(page).toHaveURL(/\/\?.*auth_error=missing_auth_code/)
  const visibleAuthMessage = page.locator('.landing-auth-message:visible').filter({ hasText: /incomplete/i })
  await expect(visibleAuthMessage).toHaveCount(1)
  await expect(visibleAuthMessage).toBeVisible()
})

test('invalid confirmation links explain how to recover', async ({ page }) => {
  await page.goto('/auth/confirm?token_hash=not-a-real-token&type=signup&next=/onboarding')
  await expect(page).toHaveURL(/\/\?.*auth_error=/)
  const visibleAuthMessage = page.locator('.landing-auth-message:visible').filter({ hasText: /expired|already been used|request a new|could not be verified/i })
  await expect(visibleAuthMessage).toHaveCount(1)
  await expect(visibleAuthMessage).toBeVisible()
  await expect(page).not.toHaveURL(/\/auth\/error/)
})

test('onboarding is protected and preserves the requested route', async ({ page }) => {
  await page.goto('/onboarding')
  await expect(page).toHaveURL(/\/\?next=%2Fonboarding|\/\?next=\/onboarding/)
})
