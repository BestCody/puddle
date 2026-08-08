import { test, expect } from '@playwright/test'
import { completeProfileDirect, createConfirmedUser, signInThroughUi } from './support.mjs'
import { fixturePlaceBySourceId } from './r2-fixture-data.mjs'
import { ensureRelationalFixturePlaces } from './relational-fixture.mjs'

function escapePattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function createParticipant(displayName) {
  const account = await createConfirmedUser({ displayName })
  await completeProfileDirect(account.user.id, {
    interests: ['cafe', 'gallery'],
    search_radius_km: 25
  })
  return account
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

test('two people receive a DateMatch from the same relational Supabase deck', async ({ browser }) => {
  const expected = fixturePlaceBySourceId('e2e-shared-date-cafe')
  const second = fixturePlaceBySourceId('e2e-shared-date-gallery')
  await ensureRelationalFixturePlaces([expected, second])

  const creator = await createParticipant('Relational DateMatch Creator')
  const partner = await createParticipant('Relational DateMatch Partner')

  const creatorContext = await browser.newContext()
  const partnerContext = await browser.newContext()
  const creatorPage = await creatorContext.newPage()
  const partnerPage = await partnerContext.newPage()

  await signInThroughUi(creatorPage, creator.email, creator.password, '/discover')
  await creatorPage.goto('/discover?q=E2E%20Shared%20Date')
  await expect(creatorPage.locator('.minimal-swipe-card h1')).toHaveText(expected.name)
  await choosePersonalCard(creatorPage, 'Save')
  await finishPersonalDeck(creatorPage)
  await creatorPage.getByRole('button', { name: 'Invite others' }).click()

  const inviteDialog = creatorPage.getByRole('dialog')
  await inviteDialog.getByRole('button', { name: /One person/i }).click()
  await expect(inviteDialog.getByText(/shared deck is ready/i)).toBeVisible()
  const roomUrl = await inviteDialog.getByRole('link', { name: /Open room/i }).getAttribute('href')
  expect(roomUrl).toBeTruthy()
  const roomPath = new URL(roomUrl).pathname

  await inviteDialog.getByRole('link', { name: /Open room/i }).click()
  await expect(creatorPage).toHaveURL(new RegExp(`${escapePattern(roomPath)}$`))
  await expect(creatorPage.getByText(/Your choices are saved privately/i)).toBeVisible()

  await signInThroughUi(partnerPage, partner.email, partner.password, roomPath)
  await expect(partnerPage).toHaveURL(new RegExp(`${escapePattern(roomPath)}$`))
  await expect(partnerPage.getByRole('heading', { name: /Choose privately. Match on the locations you both want/i })).toBeVisible()
  await expect(partnerPage.locator('.date-swipe-card h2')).toHaveText(expected.name)

  const partnerTitle = await saveSharedCard(partnerPage, 'I love this Supabase-backed place too.')
  expect(partnerTitle).toBe(expected.name)
  const partnerMatch = partnerPage.getByRole('dialog')
  await expect(partnerMatch.getByRole('heading', { name: new RegExp(`You both saved ${escapePattern(expected.name)}`, 'i') })).toBeVisible()
  await expect(partnerMatch.getByRole('button', { name: /Plan this date/i })).toBeVisible()

  const creatorMatch = creatorPage.getByRole('dialog')
  await expect(creatorMatch.getByRole('heading', { name: new RegExp(`You both saved ${escapePattern(expected.name)}`, 'i') })).toBeVisible({ timeout: 20_000 })
  await expect(creatorMatch.getByText(/I love this Supabase-backed place too/i)).toBeVisible()

  await creatorContext.close()
  await partnerContext.close()
})
