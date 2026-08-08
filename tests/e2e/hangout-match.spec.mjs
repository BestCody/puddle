import { test, expect } from '@playwright/test'
import { completeProfileDirect, createConfirmedUser, signInThroughUi } from './support.mjs'
import { fixturePlaceBySourceId } from './r2-fixture-data.mjs'
import { ensureRelationalFixturePlaces } from './relational-fixture.mjs'

function escapePattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function saveSharedCard(page, note) {
  const card = page.locator('.date-swipe-card')
  const title = await card.locator('h2').innerText()
  await card.getByRole('button', { name: /^Save/i }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: new RegExp(`Why does ${escapePattern(title)} work`, 'i') })).toBeVisible()
  await dialog.getByRole('textbox').fill(note)
  await dialog.getByRole('button', { name: /Save choice/i }).click()
  return title
}

async function choosePersonalCard(page, action) {
  const card = page.locator('.minimal-swipe-card')
  await expect(card).toBeVisible()
  const previous = await card.getAttribute('aria-label')
  await page.getByRole('button', { name: action }).click()
  await expect.poll(async () => {
    if (await page.getByRole('button', { name: 'Invite others' }).isVisible().catch(() => false)) return 'complete'
    return page.locator('.minimal-swipe-card').getAttribute('aria-label')
  }).not.toBe(previous)
}

async function finishPersonalDeck(page) {
  const invite = page.getByRole('button', { name: 'Invite others' })
  for (let index = 0; index < 12; index += 1) {
    if (await invite.isVisible().catch(() => false)) return
    await choosePersonalCard(page, 'Pass')
  }
  await expect(invite).toBeVisible()
}

async function createParticipant(displayName) {
  const account = await createConfirmedUser({ displayName })
  await completeProfileDirect(account.user.id, {
    interests: ['activity_venue', 'park'],
    search_radius_km: 25
  })
  return account
}

test('three people receive a private group match from a relational Supabase deck', async ({ browser }) => {
  const expected = fixturePlaceBySourceId('e2e-group-arcade')
  const second = fixturePlaceBySourceId('e2e-group-park')
  await ensureRelationalFixturePlaces([expected, second])

  const creator = await createParticipant('Relational Hangout Creator')
  const friendOne = await createParticipant('Relational Hangout Friend One')
  const friendTwo = await createParticipant('Relational Hangout Friend Two')

  const creatorContext = await browser.newContext()
  const friendOneContext = await browser.newContext()
  const friendTwoContext = await browser.newContext()
  const creatorPage = await creatorContext.newPage()
  const friendOnePage = await friendOneContext.newPage()
  const friendTwoPage = await friendTwoContext.newPage()

  await signInThroughUi(creatorPage, creator.email, creator.password, '/discover')
  await creatorPage.goto('/discover?q=E2E%20Group')
  await expect(creatorPage.locator('.minimal-swipe-card h1')).toHaveText(expected.name)
  await choosePersonalCard(creatorPage, 'Save')
  await finishPersonalDeck(creatorPage)
  await creatorPage.getByRole('button', { name: 'Invite others' }).click()

  const inviteDialog = creatorPage.getByRole('dialog')
  await inviteDialog.getByRole('button', { name: /A group/i }).click()
  await expect(inviteDialog.getByText(/shared deck is ready/i)).toBeVisible()
  const roomUrl = await inviteDialog.getByRole('link', { name: /Open room/i }).getAttribute('href')
  expect(roomUrl).toBeTruthy()
  const roomPath = new URL(roomUrl).pathname
  expect(roomPath).toMatch(/^\/hangout\/[a-f0-9]{64}$/i)

  await inviteDialog.getByRole('link', { name: /Open room/i }).click()
  await expect(creatorPage).toHaveURL(new RegExp(`${escapePattern(roomPath)}$`))
  await expect(creatorPage.getByText(/Invite 2 more people to start group matching/i)).toBeVisible()

  await signInThroughUi(friendOnePage, friendOne.email, friendOne.password, roomPath)
  await signInThroughUi(friendTwoPage, friendTwo.email, friendTwo.password, roomPath)
  await expect(friendTwoPage.getByText(/3 of 4 joined/i)).toBeVisible()
  await expect(friendOnePage.locator('.date-swipe-card h2')).toHaveText(expected.name)
  await expect(friendTwoPage.locator('.date-swipe-card h2')).toHaveText(expected.name)

  const friendOneTitle = await saveSharedCard(friendOnePage, 'This Supabase-backed place works for the whole group.')
  expect(friendOneTitle).toBe(expected.name)
  await expect(friendOnePage.getByText(/Group match found/i)).toHaveCount(0)

  const friendTwoTitle = await saveSharedCard(friendTwoPage, 'I would happily meet everyone here.')
  expect(friendTwoTitle).toBe(expected.name)
  const immediateMatch = friendTwoPage.getByRole('dialog')
  await expect(immediateMatch.getByRole('heading', { name: new RegExp(`Your group agrees on ${escapePattern(expected.name)}`, 'i') })).toBeVisible()
  await expect(immediateMatch.getByText(/3 people chose this location with no vetoes/i)).toBeVisible()
  await expect(immediateMatch.getByRole('button', { name: /Plan this hangout/i })).toBeVisible()

  const creatorMatch = creatorPage.getByRole('dialog')
  await expect(creatorMatch.getByRole('heading', { name: new RegExp(`Your group agrees on ${escapePattern(expected.name)}`, 'i') })).toBeVisible({ timeout: 20_000 })

  await creatorContext.close()
  await friendOneContext.close()
  await friendTwoContext.close()
})
