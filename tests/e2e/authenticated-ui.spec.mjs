import { test, expect } from '@playwright/test'
import sharp from 'sharp'
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
    strictConsole: false
  })

  await signInThroughUi(page, account.email, account.password)
  await expect(page).toHaveURL(/\/discover$/)
  await expect(page.locator('.minimal-swipe-card')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pass' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Star' })).toBeVisible()

  const filterButton = page.getByRole('button', { name: 'Open filters' })
  const shareButton = page.getByRole('button', { name: 'Send to' })
  await expect(filterButton).toBeVisible()
  await expect(shareButton).toBeVisible()
  await expect(shareButton.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/)
  const filterBox = await filterButton.boundingBox()
  const shareBox = await shareButton.boundingBox()
  expect(filterBox).toBeTruthy()
  expect(shareBox).toBeTruthy()
  expect(Math.abs((shareBox.y + shareBox.height / 2) - (filterBox.y + filterBox.height / 2))).toBeLessThanOrEqual(8)
  expect(shareBox.x + shareBox.width).toBeLessThanOrEqual(filterBox.x - 4)
  await shareButton.click()
  await expect(page.getByRole('heading', { name: 'Send to' })).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()

  await assertProductVisualContract(page)
  await assertImagesLoaded(page)
  await assertNoHorizontalOverflow(page)

  await page.goto('/plans')
  await assertPageShell(page, 'Saved')

  await page.goto('/matches')
  await assertPageShell(page, 'Friends')
  await expect(page.getByRole('button', { name: 'Friends', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Messages', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Shared', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Friends' })).toHaveAttribute('aria-current', 'page')

  await page.goto('/membership')
  await assertPageShell(page, 'Membership')
  await expect(page.getByText('Free', { exact: true })).toBeVisible()
  await expect(page.getByText('Tinder tier', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Pass' })).toHaveAttribute('aria-current', 'page')

  await page.goto('/global-matches')
  await assertPageShell(page, 'Global likes')
  await expect(page.getByRole('heading', { name: 'Included with Tinder tier' })).toBeVisible()

  await page.goto('/profile')
  await expect(page.locator('.minimal-profile-card h1')).toHaveText('UI Contract Tester')
  await expect(page.getByText('Profile picture', { exact: true })).toBeVisible()
  await assertProductVisualContract(page)
  await assertImagesLoaded(page)
  await assertNoHorizontalOverflow(page)

  const activeLabels = await page.locator('[aria-current="page"]').allTextContents()
  expect(activeLabels.join(' ')).toContain('Profile')
  health.assertHealthy()
})

test('changing a profile picture uploads and renders the actual color image after reload', async ({ page, request }) => {
  const account = await createConfirmedUser({ displayName: 'Profile Photo Tester' })
  await completeProfileDirect(account.user.id, { display_name: 'Profile Photo Tester' })
  await signInThroughUi(page, account.email, account.password, '/profile')
  await expect(page.locator('.minimal-profile-card h1')).toHaveText('Profile Photo Tester')

  const imageBuffer = await sharp({
    create: {
      width: 96,
      height: 96,
      channels: 3,
      background: { r: 238, g: 70, b: 122 }
    }
  }).png().toBuffer()

  const input = page.locator('.profile-photo-editor input[type="file"]')
  await input.setInputFiles({ name: 'profile-test.png', mimeType: 'image/png', buffer: imageBuffer })
  await expect(page.getByAltText('Profile preview')).toBeVisible()
  await page.getByRole('button', { name: 'Save photo' }).click()
  await expect(page.getByText('Profile picture updated.')).toBeVisible({ timeout: 20_000 })

  await page.reload()
  const profileImage = page.locator('.minimal-profile-avatar img')
  await expect(profileImage).toBeVisible()
  await expect.poll(async () => profileImage.evaluate((image) => image.complete && image.naturalWidth > 0)).toBeTruthy()
  const src = await profileImage.getAttribute('src')
  expect(src).toBeTruthy()

  const response = await request.get(src)
  expect(response.ok()).toBeTruthy()
  expect(response.headers()['content-type'] || '').toMatch(/^image\//)
  const persisted = await response.body()
  const stats = await sharp(persisted).stats()
  expect(stats.channels[0].mean).toBeGreaterThan(stats.channels[1].mean + 80)
}
