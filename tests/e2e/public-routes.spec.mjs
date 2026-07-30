import { test, expect } from '@playwright/test'
import { assertNoHorizontalOverflow } from './support.mjs'

const publicPages = [
  ['/', 'Puddle'],
  ['/signin', 'Jump back into your Puddle.'],
  ['/signup', 'Make plans that leave the chat.'],
  ['/privacy', 'Privacy Policy'],
  ['/terms', 'Terms of Service']
]

for (const [path, heading] of publicPages) {
  test(`${path} renders without horizontal overflow`, async ({ page }) => {
    await page.goto(path)
    if (path === '/') {
      await expect(page.locator('body')).toContainText(heading)
    } else {
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
    }
    await assertNoHorizontalOverflow(page)
  })
}

test('landing page links to signup, privacy, and terms', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('a[href="/signup"]:visible').first()).toBeVisible()
  await expect(page.locator('a[href="/privacy"]:visible').first()).toBeVisible()
  await expect(page.locator('a[href="/terms"]:visible').first()).toBeVisible()
})

test('callback provider failures return a useful sign-in message', async ({ page }) => {
  await page.goto('/auth/callback?error=access_denied&error_description=cancelled')
  await expect(page).toHaveURL(/\/signin\?.*auth_error=access_denied/)
  await expect(page.getByText(/cancelled|not approved/i)).toBeVisible()
  await expect(page).not.toHaveURL(/\/auth\/error/)
})

test('missing callback codes do not expose a generic error page', async ({ page }) => {
  await page.goto('/auth/callback?next=/onboarding')
  await expect(page).toHaveURL(/\/signin\?.*auth_error=missing_auth_code/)
  await expect(page.getByText(/incomplete/i)).toBeVisible()
})

test('invalid confirmation links explain how to recover', async ({ page }) => {
  await page.goto('/auth/confirm?token_hash=not-a-real-token&type=signup&next=/onboarding')
  await expect(page).toHaveURL(/\/signin\?.*auth_error=/)
  await expect(page.getByText(/expired|already been used|request a new|could not be verified/i)).toBeVisible()
  await expect(page).not.toHaveURL(/\/auth\/error/)
})

test('onboarding is protected and preserves the requested route', async ({ page }) => {
  await page.goto('/onboarding')
  await expect(page).toHaveURL(/\/signin\?next=%2Fonboarding|\/signin\?next=\/onboarding/)
})
