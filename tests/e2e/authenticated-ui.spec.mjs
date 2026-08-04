import { test, expect } from '@playwright/test'
import {
  assertNoHorizontalOverflow,
  completeProfileDirect,
  createConfirmedUser,
  signInThroughUi
} from './support.mjs'
import {
  assertImagesLoaded,
  assertProductVisualContract,
  trackFrontendHealth
} from './frontend-health.mjs'

const catalogueOrigin = process.env.E2E_R2_BASE_URL || 'http://127.0.0.1:43110'

async function assertPageShell(page, heading) {
  await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
  await assertProductVisualContract(page)
  await assertImagesLoaded(page)
  await assertNoHorizontalOverflow(page)
}

test('authenticated product UI renders across core pages on desktop and mobile', async ({ page }, testInfo) => {
  const account = await createConfirmedUser({ displayName: 'UI Contract Tester' })
  await completeProfileDirect(account.user.id, { display_name: 'UI Contract Tester' })

  const health = trackFrontendHealth(page, {
    baseURL: testInfo.project.use.baseURL,
    additionalOrigins: [catalogueOrigin],
    strictConsole: false
  })

  await signInThroughUi(page, account.email, account.password)
  await expect(page).toHaveURL(/\/discover$/)
  await expect(page.locator('.minimal-swipe-card')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pass' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()
  await assertProductVisualContract(page)
  await assertImagesLoaded(page)
  await assertNoHorizontalOverflow(page)

  await page.goto('/plans')
  await assertPageShell(page, 'Saved')

  await page.goto('/matches')
  await assertPageShell(page, 'Matches')

  await page.goto('/membership')
  await assertPageShell(page, 'Membership')
  await expect(page.getByText('Free', { exact: true })).toBeVisible()
  await expect(page.getByText('Tinder tier', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Tiers' })).toHaveAttribute('aria-current', 'page')

  await page.goto('/global-matches')
  await assertPageShell(page, 'Global likes')
  await expect(page.getByRole('heading', { name: 'Included with Tinder tier' })).toBeVisible()

  await page.goto('/profile')
  await expect(page.locator('.minimal-profile-card h1')).toHaveText('UI Contract Tester')
  await assertProductVisualContract(page)
  await assertImagesLoaded(page)
  await assertNoHorizontalOverflow(page)

  const activeLabels = await page.locator('[aria-current="page"]').allTextContents()
  expect(activeLabels.join(' ')).toContain('Profile')
  health.assertHealthy()
})
