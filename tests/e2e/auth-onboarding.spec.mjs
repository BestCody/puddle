import { test, expect } from '@playwright/test'
import {
  admin,
  completeProfileDirect,
  createConfirmedUser,
  deleteProfile,
  directConfirmationPath,
  findUserByEmail,
  signInThroughUi,
  signOutThroughUi,
  uniqueEmail,
  uniqueSuffix,
  waitForAuthEmailLink,
  waitForProfile
} from './support.mjs'

async function fillOnboarding(page, { username, city = 'Toronto', bio = 'Saved browser-test progress.' } = {}) {
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Birth date').fill('19940615')
  await expect(page.getByLabel('Birth date')).toHaveValue('1994-06-15')
  await page.getByLabel('City').fill(city)
  await page.getByLabel('Search radius').fill('25')
  await page.getByLabel('Live music').check()
  await page.getByLabel('Food').check()
  await page.getByLabel('Art').check()
  await page.getByLabel('Tiny bio').fill(bio)
  await page.getByLabel('Profile visibility').selectOption('mutuals')
}

test('email signup, confirmation, onboarding, sign-in, reset, and sign-out work end to end', async ({ page, browser }) => {
  const email = uniqueEmail('complete-flow')
  const password = 'OriginalPuddle123!'
  const newPassword = 'ReplacementPuddle456!'
  const username = `flow_${uniqueSuffix(12)}`

  await page.goto('/signup')
  await page.getByLabel('Display name').fill('Complete Flow')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: /Create my Puddle/i }).click()
  await expect(page).toHaveURL(/\/verify-email\?email=/)
  await expect(page.getByText(/Check your inbox/i)).toBeVisible()

  const user = await findUserByEmail(email)
  const automaticProfile = await waitForProfile(user.id)
  expect(automaticProfile.display_name).toBe('Complete Flow')
  expect(automaticProfile.onboarding_completed_at).toBeNull()

  const verificationLink = await waitForAuthEmailLink(email, 'signup')
  const confirmationPath = directConfirmationPath(verificationLink)
  await page.goto(confirmationPath)
  await expect(page).toHaveURL(/\/onboarding$/)
  await expect(page.getByRole('heading', { name: /Teach Puddle your vibe/i })).toBeVisible()
  await expect(page.getByLabel('Profile visibility')).toHaveValue('public')
  await expect(page.getByRole('button', { name: /Save and continue later/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Build my feed/i })).toHaveCount(1)

  const cleanContext = await browser.newContext()
  const reusedPage = await cleanContext.newPage()
  await reusedPage.goto(confirmationPath)
  await expect(reusedPage).toHaveURL(/\/signin\?.*auth_error=/)
  await expect(reusedPage.getByText(/expired|already been used|request a new/i)).toBeVisible()
  await cleanContext.close()

  await fillOnboarding(page, { username })
  await page.getByRole('button', { name: /Build my feed/i }).click()
  await expect(page).toHaveURL(/\/discover\?success=/)
  await expect(page.getByText(/Welcome to Puddle/i)).toBeVisible()

  const completedProfile = await waitForProfile(user.id)
  expect(completedProfile.username).toBe(username)
  expect(completedProfile.city).toBe('Toronto')
  expect(completedProfile.search_radius_km).toBe(25)
  expect(completedProfile.interests).toEqual(expect.arrayContaining(['Live music', 'Food', 'Art']))
  expect(completedProfile.profile_visibility).toBe('mutuals')
  expect(completedProfile.onboarding_completed_at).toBeTruthy()

  await signOutThroughUi(page)
  await signInThroughUi(page, email, password)
  await expect(page).toHaveURL(/\/discover$/)

  await signOutThroughUi(page)
  await page.goto('/forgot-password')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: /Send reset link/i }).click()
  await expect(page).toHaveURL(/\/forgot-password\?success=/)
  await expect(page.getByText(/reset link is on the way/i)).toBeVisible()

  const recoveryLink = await waitForAuthEmailLink(email, 'recovery')
  await page.goto(recoveryLink)
  await expect(page).toHaveURL(/\/update-password$/)
  await page.getByLabel('New password').fill(newPassword)
  await page.getByLabel('Confirm password').fill(newPassword)
  await page.getByRole('button', { name: /Update password/i }).click()
  await expect(page).toHaveURL(/\/account\?success=/)
  await expect(page.getByText(/Password updated/i)).toBeVisible()

  await signOutThroughUi(page)
  await signInThroughUi(page, email, password)
  await expect(page).toHaveURL(/\/signin\?.*error=/)
  await expect(page.getByText(/Email or password was not accepted/i)).toBeVisible()

  await signInThroughUi(page, email, newPassword)
  await expect(page).toHaveURL(/\/discover$/)
  await signOutThroughUi(page)
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/signin\?next=%2Fdashboard|\/signin\?next=\/dashboard/)
})

test('duplicate usernames preserve the rest of onboarding progress', async ({ page }) => {
  const sharedUsername = `shared_${uniqueSuffix(12)}`
  const owner = await createConfirmedUser({ displayName: 'Username Owner' })
  await completeProfileDirect(owner.user.id, { username: sharedUsername })

  const candidate = await createConfirmedUser({ displayName: 'Username Candidate' })
  await signInThroughUi(page, candidate.email, candidate.password)
  await expect(page).toHaveURL(/\/onboarding$/)
  await fillOnboarding(page, { username: sharedUsername, city: 'Montreal', bio: 'Keep this even when the username conflicts.' })
  await page.getByRole('button', { name: /Build my feed/i }).click()

  await expect(page).toHaveURL(/\/onboarding\?error=/)
  await expect(page.getByText(/username is already taken/i)).toBeVisible()
  const profile = await waitForProfile(candidate.user.id)
  expect(profile.username).not.toBe(sharedUsername)
  expect(profile.city).toBe('Montreal')
  expect(profile.bio).toBe('Keep this even when the username conflicts.')
  expect(profile.interests).toEqual(expect.arrayContaining(['Live music', 'Food', 'Art']))
  expect(profile.onboarding_completed_at).toBeNull()
})

test('a missing profile row is recreated after password sign-in', async ({ page }) => {
  const account = await createConfirmedUser({ displayName: 'Recovered Profile' })
  await deleteProfile(account.user.id)
  const { data: deleted } = await admin.from('profiles').select('id').eq('id', account.user.id).maybeSingle()
  expect(deleted).toBeNull()

  await signInThroughUi(page, account.email, account.password)
  await expect(page).toHaveURL(/\/onboarding$/)
  const recovered = await waitForProfile(account.user.id)
  expect(recovered.display_name).toBe('Recovered Profile')
  expect(recovered.onboarding_completed_at).toBeNull()
})
