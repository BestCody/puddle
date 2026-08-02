import { test, expect } from '@playwright/test'
import { completeProfileDirect, createConfirmedUser, signInThroughUi, waitForProfile } from './support.mjs'

async function waitForNextCardOrCompletion(page, previousLabel) {
  const invite = page.getByRole('button', { name: 'Invite others' })
  await expect.poll(async () => {
    if (await invite.isVisible().catch(() => false)) return 'complete'
    return page.locator('.minimal-swipe-card').getAttribute('aria-label')
  }).not.toBe(previousLabel)
}

test('date locations are swiped, inspected, undone, filtered, and updated from account settings', async ({ page }) => {
  const account = await createConfirmedUser({ displayName: 'Date Swiper' })
  await completeProfileDirect(account.user.id, {
    interests: ['cafe', 'gallery', 'scenic_spot'],
    search_radius_km: 25,
    profile_visibility: 'public'
  })

  await signInThroughUi(page, account.email, account.password, '/discover')
  await expect(page).toHaveURL(/\/discover$/)
  const card = page.locator('.minimal-swipe-card')
  await expect(card).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open filters' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Swipe' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Saved' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Matches' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Profile' })).toBeVisible()

  const firstTitle = await card.locator('h1').innerText()
  const firstLabel = await card.getAttribute('aria-label')
  await expect(page.locator('.minimal-swipe-action')).toHaveCount(4)
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Pass' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Perfect' })).toBeVisible()

  await card.click()
  const details = page.getByRole('dialog')
  await expect(details).toBeVisible()
  await expect(details.getByRole('heading', { name: firstTitle })).toBeVisible()
  await expect(details.getByRole('link', { name: 'Full details' })).toBeVisible()
  await details.getByRole('button', { name: 'Close details' }).click()
  await expect(details).toHaveCount(0)

  await page.getByRole('button', { name: 'Save' }).click()
  await waitForNextCardOrCompletion(page, firstLabel)
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled()

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.minimal-swipe-card h1')).toHaveText(firstTitle)

  await page.getByRole('button', { name: 'Open filters' }).click()
  const filters = page.getByRole('dialog')
  await expect(filters.getByRole('heading', { name: 'Filters' })).toBeVisible()
  await filters.getByLabel('Distance').selectOption('50')
  await filters.getByRole('button', { name: 'Apply' }).click()
  await expect(filters).toHaveCount(0)
  await expect(page.locator('.minimal-swipe-card')).toBeVisible()

  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/discover$/)
  await expect(page.locator('.minimal-swipe-card')).toBeVisible()

  await page.goto('/account')
  await expect(page.getByRole('heading', { name: /Account settings/i })).toBeVisible()
  await expect(page.getByText(/These choices shape the places in your swipe deck/i)).toBeVisible()
  await expect(page.getByLabel('Coffee shops')).toBeChecked()
  await expect(page.getByLabel('Galleries')).toBeChecked()
  await expect(page.getByLabel('Scenic spots')).toBeChecked()

  await page.getByLabel('Coffee shops').uncheck()
  await page.getByLabel('Galleries').uncheck()
  await page.getByLabel('Scenic spots').uncheck()
  await page.getByLabel('Restaurants').check()
  await page.getByLabel('Parks & gardens').check()
  await page.getByLabel('Activity dates').check()
  await page.getByRole('button', { name: /Save profile and date preferences/i }).click()

  await expect(page).toHaveURL(/\/account\?success=/)
  await expect(page.getByText(/Profile and date preferences saved/i)).toBeVisible()
  const updatedProfile = await waitForProfile(account.user.id)
  expect(updatedProfile.interests).toEqual(expect.arrayContaining(['restaurant', 'park', 'activity_venue']))
  expect(updatedProfile.interests).not.toEqual(expect.arrayContaining(['cafe', 'gallery', 'scenic_spot']))
})
