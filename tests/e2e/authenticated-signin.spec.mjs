import { test, expect } from '@playwright/test'
import { completeProfileDirect, createConfirmedUser, signInThroughUi } from './support.mjs'
import { trackFrontendHealth } from './frontend-health.mjs'

test('an authenticated user can open the explicit sign-in route without reusing the current session', async ({ page }, testInfo) => {
  const account = await createConfirmedUser({ displayName: 'Returning Signin Tester' })
  await completeProfileDirect(account.user.id, { display_name: 'Returning Signin Tester' })
  const health = trackFrontendHealth(page, { baseURL: testInfo.project.use.baseURL, strictConsole: false })

  await signInThroughUi(page, account.email, account.password)
  await expect(page).toHaveURL(/\/discover$/)
  await expect(page.locator('.figma-swipe-card')).toBeVisible()

  await page.goto('/')
  await expect(page).toHaveURL(/\/discover$/)
  await page.goto('/signin')

  await expect(page).toHaveURL(/\/signin$/)
  await expect(page.getByRole('heading', { name: 'Discover places. See who’s there.' })).toBeVisible()
  await expect(page.getByLabel('Email').first()).toBeVisible()
  health.assertHealthy()
})
