import { test, expect } from '@playwright/test'
import { completeProfileDirect, createConfirmedUser, signInThroughUi } from './support.mjs'
import { trackFrontendHealth } from './frontend-health.mjs'

test('an authenticated user clicking Sign In from home is redirected to a healthy Discover page', async ({ page }, testInfo) => {
  const account = await createConfirmedUser({ displayName: 'Returning Signin Tester' })
  await completeProfileDirect(account.user.id, { display_name: 'Returning Signin Tester' })
  const health = trackFrontendHealth(page, { baseURL: testInfo.project.use.baseURL, strictConsole: false })

  await signInThroughUi(page, account.email, account.password)
  await expect(page).toHaveURL(/\/discover$/)
  await expect(page.locator('.minimal-swipe-card')).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Sign In', exact: true }).first()).toBeVisible()
  await page.getByRole('link', { name: 'Sign In', exact: true }).first().click()

  await expect(page).toHaveURL(/\/discover$/)
  await expect(page.getByRole('heading', { name: 'Tiny wipeout.' })).toHaveCount(0)
  await expect(page.locator('.minimal-product-shell')).toBeVisible()
  await expect(page.locator('.minimal-swipe-card')).toBeVisible()
  health.assertHealthy()
})
