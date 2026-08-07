import { test, expect } from '@playwright/test'
import { completeProfileDirect, createConfirmedUser, signInThroughUi } from './support.mjs'

test('an authenticated user can revisit sign-in without an automatic discover redirect', async ({ page }) => {
  const account = await createConfirmedUser({ displayName: 'Returning Signin Tester' })
  await completeProfileDirect(account.user.id, { display_name: 'Returning Signin Tester' })

  await signInThroughUi(page, account.email, account.password)
  await expect(page).toHaveURL(/\/discover$/)
  await expect(page.locator('.minimal-swipe-card')).toBeVisible()

  await page.goto('/')
  await page.getByRole('link', { name: 'Sign In', exact: true }).first().click()

  await expect(page).toHaveURL(/\/signin$/)
  await expect(page.getByRole('heading', { name: /already signed in/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /Continue to Puddle/i })).toBeVisible()

  await page.getByRole('link', { name: /Continue to Puddle/i }).click()
  await expect(page).toHaveURL(/\/discover$/)
  await expect(page.locator('.minimal-swipe-card')).toBeVisible()
})
