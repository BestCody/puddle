import { test, expect } from '@playwright/test'
import { completeProfileDirect, createConfirmedUser, signInThroughUi, waitForProfile } from './support.mjs'

test('date locations are swiped, inspected, noted, undone, and updated from account settings', async ({ page }) => {
  const account = await createConfirmedUser({ displayName: 'Date Swiper' })
  await completeProfileDirect(account.user.id, {
    interests: ['cafe', 'gallery', 'scenic_spot'],
    search_radius_km: 25,
    profile_visibility: 'public'
  })

  await signInThroughUi(page, account.email, account.password, '/discover')
  await expect(page).toHaveURL(/\/discover$/)
  await expect(page.getByRole('heading', { name: /Find somewhere you actually want to go/i })).toBeVisible()
  await expect(page.getByText(/Your 12-card location deck/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /Swipe together/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^deck$/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^list$/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^map$/i })).toHaveCount(0)

  const card = page.locator('.date-swipe-card')
  await expect(card).toBeVisible()
  const firstTitle = await card.locator('h2').innerText()
  await expect(card.getByText(/Puddle Pick/i)).toBeVisible()

  const dockButtons = page.locator('.swipe-control-dock .swipe-control')
  await expect(dockButtons).toHaveCount(4)
  await expect(dockButtons.nth(0)).toHaveAttribute('data-action', 'undo')
  await expect(dockButtons.nth(1)).toHaveAttribute('data-action', 'pass')
  await expect(dockButtons.nth(2)).toHaveAttribute('data-action', 'save')
  await expect(dockButtons.nth(3)).toHaveAttribute('data-action', 'perfect')
  await expect(page.getByRole('button', { name: /Undo\. Bring back the last card/i })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Pass\. Not this one/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Save\. Add to your shortlist/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Perfect Pick\. This one stands out/i })).toBeVisible()

  await card.getByRole('button', { name: 'Details' }).click()
  const details = page.getByRole('dialog')
  await expect(details).toBeVisible()
  await expect(details.getByRole('heading', { name: firstTitle })).toBeVisible()
  await details.getByRole('button', { name: 'Close details' }).click()
  await expect(details).toHaveCount(0)

  await page.getByRole('button', { name: /Save\. Add to your shortlist/i }).click()
  const noteDialog = page.getByRole('dialog')
  await expect(noteDialog.getByRole('heading', { name: /Add it to your shortlist/i })).toBeVisible()
  await noteDialog.getByRole('textbox').fill('Looks easy to talk in and close to both of us.')
  await noteDialog.getByRole('button', { name: /Save location/i }).click()
  await expect(page.getByText(new RegExp(`Saved · ${firstTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeVisible()
  await expect(page.locator('.date-swipe-card h2')).not.toHaveText(firstTitle)

  await page.getByRole('button', { name: /Undo\. Bring back the last card/i }).click()
  await expect(page.locator('.date-swipe-card h2')).toHaveText(firstTitle)

  await page.getByRole('button', { name: /^Filters$/i }).click()
  await expect(page.getByLabel('Maximum distance')).toBeVisible()
  await expect(page.getByLabel('Open now')).toBeVisible()
  await page.getByLabel('Maximum distance').fill('50')
  await page.getByRole('button', { name: /Build this deck/i }).click()
  await expect(page.getByLabel('Maximum distance')).toHaveCount(0)

  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: /what is the next move/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /Open Swipe/i })).toBeVisible()

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
