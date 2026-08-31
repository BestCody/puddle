import { test, expect } from '@playwright/test'
import {
  admin,
  completeProfileDirect,
  createConfirmedUser,
  signInThroughUi,
  signOutThroughUi,
  uniqueEmail,
  uniqueSuffix,
  waitForAuthEmailLink
} from './support.mjs'

async function authUserId(userId) {
  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error && error.status !== 404) throw error
  return data?.user?.id || null
}

async function removeTestUser(userId) {
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error && error.status !== 404) throw error
}

test('landing credential sign-in goes directly to discover', async ({ page }) => {
  const account = await createConfirmedUser({ displayName: 'Landing Sign In' })
  await completeProfileDirect(account.user.id)

  try {
    await page.goto('/')
    await page.locator('#landing-email').fill(account.email)
    await page.locator('#landing-password').fill(account.password)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page).toHaveURL(/\/discover(?:\?.*)?$/)
  } finally {
    await removeTestUser(account.user.id)
  }
})

test('an invalid sign-in cannot reuse the previous browser session', async ({ page }) => {
  const account = await createConfirmedUser({ displayName: 'Session Isolation' })
  await completeProfileDirect(account.user.id)

  try {
    await signInThroughUi(page, account.email, account.password, '/account')
    await expect(page).toHaveURL(/\/account$/)

    await signOutThroughUi(page)
    await page.goto('/?next=%2Faccount')
    await expect(page.locator('#landing-email')).toBeVisible()
    await page.locator('#landing-email').fill(uniqueEmail('not-an-account'))
    await page.locator('#landing-password').fill(`wrong-${uniqueSuffix(20)}-Aa1!`)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()

    await expect(page).toHaveURL(/\/\?.*error=/)
    await page.goto('/account')
    await expect(page).toHaveURL(/\/\?next=/)
  } finally {
    await removeTestUser(account.user.id)
  }
})

test('the auth cookie survives a browser-context restart', async ({ browser }) => {
  const account = await createConfirmedUser({ displayName: 'Persistent Session' })
  await completeProfileDirect(account.user.id)
  const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000'
  let firstContext
  let secondContext

  try {
    firstContext = await browser.newContext({ baseURL })
    const firstPage = await firstContext.newPage()
    await signInThroughUi(firstPage, account.email, account.password, '/account')
    const authCookies = (await firstContext.cookies()).filter(({ name }) => /^sb-.+-auth-token(?:\.\d+)?$/i.test(name))
    expect(authCookies.length).toBeGreaterThan(0)
    expect(authCookies.every(({ expires }) => expires > Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60)).toBeTruthy()
    const storageState = await firstContext.storageState()
    await firstContext.close()
    firstContext = null

    secondContext = await browser.newContext({ baseURL, storageState })
    const secondPage = await secondContext.newPage()
    await secondPage.goto('/account')
    await expect(secondPage).toHaveURL(/\/account$/)
    await secondPage.goto('/')
    await expect(secondPage).toHaveURL(/\/discover(?:\?.*)?$/)
  } finally {
    await secondContext?.close()
    await firstContext?.close()
    await removeTestUser(account.user.id)
  }
})

test('password recovery reaches the password update page and changes the password', async ({ page }) => {
  const account = await createConfirmedUser({ displayName: 'Password Recovery' })
  const newPassword = `Puddle-${uniqueSuffix(18)}-Bb2!`
  await completeProfileDirect(account.user.id)

  try {
    await page.goto('/forgot-password')
    await page.getByLabel('Email').fill(account.email)
    await page.getByRole('button', { name: /Send reset link/i }).click()
    await expect(page).toHaveURL(/\/forgot-password\?success=/)

    const recoveryLink = await waitForAuthEmailLink(account.email, 'recovery')
    await page.goto(recoveryLink)
    await expect(page).toHaveURL(/\/update-password$/)
    await page.getByLabel('New password').fill(newPassword)
    await page.getByLabel('Confirm password').fill(newPassword)
    await page.getByRole('button', { name: /Update password/i }).click()
    await expect(page).toHaveURL(/\/account\?success=/)
    await expect(page.getByText(/Password updated/i)).toBeVisible()
  } finally {
    await removeTestUser(account.user.id)
  }
})

test('account deletion removes the auth user, profile, and browser session', async ({ page }) => {
  const account = await createConfirmedUser({ displayName: 'Account Deletion' })
  await completeProfileDirect(account.user.id)

  try {
    await signInThroughUi(page, account.email, account.password, '/account')
    await expect(page).toHaveURL(/\/account$/)
    await page.locator('#account-delete-confirmation').fill('DELETE')
    await page.getByRole('button', { name: 'Delete my account', exact: true }).click()
    await expect(page).toHaveURL(/\/\?account=deleted$/)

    await expect.poll(() => authUserId(account.user.id), { timeout: 12_000 }).toBeNull()
    await expect.poll(async () => {
      const { data, error } = await admin.from('profiles').select('id').eq('id', account.user.id).maybeSingle()
      if (error) throw error
      return data?.id || null
    }, { timeout: 12_000 }).toBeNull()

    await page.goto('/account')
    await expect(page).toHaveURL(/\/\?next=/)
  } finally {
    await removeTestUser(account.user.id)
  }
})
