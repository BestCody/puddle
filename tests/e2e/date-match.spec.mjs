import { test, expect } from '@playwright/test'
import { admin, completeProfileDirect, createConfirmedUser, poll, signInThroughUi } from './support.mjs'
import { fixturePlaceBySourceId } from './r2-fixture-data.mjs'

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

test('two people receive a DateMatch from the same signed R2 deck', async ({ browser }) => {
  const creator = await createParticipant('R2 DateMatch Creator')
  const partner = await createParticipant('R2 DateMatch Partner')
  const expected = fixturePlaceBySourceId('e2e-shared-date-cafe')
  const second = fixturePlaceBySourceId('e2e-shared-date-gallery')

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

  await poll(async () => {
    const result = await admin.from('locations').select('id').in('id', [expected.id, second.id])
    if (result.error) throw result.error
    return result.data?.length === 2 ? result.data : null
  }, { timeout: 20_000, message: 'Shared-deck creation did not materialize all signed R2 locations.' })
  const retention = await admin
    .from('static_catalogue_materializations')
    .select('location_id,retention_class,expires_at')
    .in('location_id', [expected.id, second.id])
  if (retention.error) throw retention.error
  expect(retention.data).toHaveLength(2)
  expect(retention.data.every((row) => row.retention_class === 'shared' && row.expires_at === null)).toBe(true)

  await inviteDialog.getByRole('link', { name: /Open room/i }).click()
  await expect(creatorPage).toHaveURL(new RegExp(`${escapePattern(roomPath)}$`))
  await expect(creatorPage.getByText(/Your choices are saved privately/i)).toBeVisible()

  await signInThroughUi(partnerPage, partner.email, partner.password, roomPath)
  await expect(partnerPage).toHaveURL(new RegExp(`${escapePattern(roomPath)}$`))
  await expect(partnerPage.getByRole('heading', { name: /Choose privately. Match on the locations you both want/i })).toBeVisible()
  await expect(partnerPage.locator('.date-swipe-card h2')).toHaveText(expected.name)

  const partnerTitle = await saveSharedCard(partnerPage, 'I love this R2-backed place too.')
  expect(partnerTitle).toBe(expected.name)
  const partnerMatch = partnerPage.getByRole('dialog')
  await expect(partnerMatch.getByRole('heading', { name: new RegExp(`You both saved ${escapePattern(expected.name)}`, 'i') })).toBeVisible()
  await expect(partnerMatch.getByRole('button', { name: /Plan this date/i })).toBeVisible()

  const creatorMatch = creatorPage.getByRole('dialog')
  await expect(creatorMatch.getByRole('heading', { name: new RegExp(`You both saved ${escapePattern(expected.name)}`, 'i') })).toBeVisible({ timeout: 20_000 })
  await expect(creatorMatch.getByText(/I love this R2-backed place too/i)).toBeVisible()

  await creatorContext.close()
  await partnerContext.close()
})
