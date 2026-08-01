import { test, expect } from '@playwright/test'
import { completeProfileDirect, createConfirmedUser, signInThroughUi } from './support.mjs'

function escapePattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function saveCurrentCard(page, note) {
  const card = page.locator('.date-swipe-card')
  const title = await card.locator('h2').innerText()
  await card.getByRole('button', { name: /^Save/i }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: new RegExp(`Why does ${escapePattern(title)} work`, 'i') })).toBeVisible()
  await dialog.getByRole('textbox').fill(note)
  await dialog.getByRole('button', { name: /Save choice/i }).click()
  return title
}

async function createParticipant(displayName) {
  const account = await createConfirmedUser({ displayName })
  await completeProfileDirect(account.user.id, {
    interests: ['cafe', 'gallery', 'activity_venue'],
    search_radius_km: 25
  })
  return account
}

test('three people privately choose and receive a Group Hangout Match', async ({ browser }) => {
  const creator = await createParticipant('Hangout Creator')
  const friendOne = await createParticipant('Hangout Friend One')
  const friendTwo = await createParticipant('Hangout Friend Two')

  const creatorContext = await browser.newContext()
  const friendOneContext = await browser.newContext()
  const friendTwoContext = await browser.newContext()
  const creatorPage = await creatorContext.newPage()
  const friendOnePage = await friendOneContext.newPage()
  const friendTwoPage = await friendTwoContext.newPage()

  await signInThroughUi(creatorPage, creator.email, creator.password, '/discover')
  await creatorPage.getByRole('button', { name: /Group hangout/i }).click()

  const setupDialog = creatorPage.getByRole('dialog')
  await expect(setupDialog.getByRole('heading', { name: /Let the group choose privately/i })).toBeVisible()
  await setupDialog.getByLabel('Maximum people').fill('3')
  await setupDialog.getByRole('button', { name: /Create group deck/i }).click()

  const shareDialog = creatorPage.getByRole('dialog')
  await expect(shareDialog.getByRole('heading', { name: /Your Hangout Match room is ready/i })).toBeVisible()
  const roomUrl = await shareDialog.getByRole('link', { name: /Open room/i }).getAttribute('href')
  expect(roomUrl).toBeTruthy()
  const roomPath = new URL(roomUrl).pathname
  expect(roomPath).toMatch(/^\/hangout\/[a-f0-9]{64}$/i)

  await shareDialog.getByRole('link', { name: /Open room/i }).click()
  await expect(creatorPage).toHaveURL(new RegExp(`${escapePattern(roomPath)}$`))
  await expect(creatorPage.getByRole('heading', { name: /Choose privately. Reveal where the group agrees/i })).toBeVisible()
  await expect(creatorPage.getByText(/Invite 2 more people to unlock group matching/i)).toBeVisible()

  await signInThroughUi(friendOnePage, friendOne.email, friendOne.password, roomPath)
  await signInThroughUi(friendTwoPage, friendTwo.email, friendTwo.password, roomPath)
  await expect(friendTwoPage.getByText(/3 of 3 joined/i)).toBeVisible()

  const creatorTitle = await creatorPage.locator('.date-swipe-card h2').innerText()
  expect(await friendOnePage.locator('.date-swipe-card h2').innerText()).toBe(creatorTitle)
  expect(await friendTwoPage.locator('.date-swipe-card h2').innerText()).toBe(creatorTitle)

  await saveCurrentCard(creatorPage, 'Easy transit and enough room for everyone.')
  await expect(creatorPage.getByText(/Group match found/i)).toHaveCount(0)

  await saveCurrentCard(friendOnePage, 'This works well for the whole group.')
  await expect(friendOnePage.getByText(/Group match found/i)).toHaveCount(0)

  await saveCurrentCard(friendTwoPage, 'I would happily meet everyone here.')
  const immediateMatch = friendTwoPage.getByRole('dialog')
  await expect(immediateMatch.getByRole('heading', { name: new RegExp(`Your group agrees on ${escapePattern(creatorTitle)}`, 'i') })).toBeVisible()
  await expect(immediateMatch.getByText(/3 people chose this location with no vetoes/i)).toBeVisible()
  await expect(immediateMatch.getByRole('button', { name: /Plan this hangout/i })).toBeVisible()

  const creatorMatch = creatorPage.getByRole('dialog')
  await expect(creatorMatch.getByRole('heading', { name: new RegExp(`Your group agrees on ${escapePattern(creatorTitle)}`, 'i') })).toBeVisible({ timeout: 20_000 })
  await expect(creatorMatch.getByRole('button', { name: /Plan this hangout/i })).toBeVisible()

  await creatorContext.close()
  await friendOneContext.close()
  await friendTwoContext.close()
})