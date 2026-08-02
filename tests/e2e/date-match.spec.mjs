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

async function finishPersonalDeck(page) {
  const pass = page.getByRole('button', { name: 'Pass' })
  for (let index = 0; index < 12; index += 1) {
    if (!await pass.isVisible().catch(() => false)) break
    await pass.click()
  }
  await expect(page.getByRole('button', { name: 'Invite others' })).toBeVisible()
}

test('two people privately swipe the same deck and both receive a DateMatch', async ({ browser }) => {
  const creator = await createConfirmedUser({ displayName: 'DateMatch Creator' })
  const partner = await createConfirmedUser({ displayName: 'DateMatch Partner' })
  await completeProfileDirect(creator.user.id, { interests: ['cafe', 'gallery'], search_radius_km: 25 })
  await completeProfileDirect(partner.user.id, { interests: ['cafe', 'gallery'], search_radius_km: 25 })

  const creatorContext = await browser.newContext()
  const partnerContext = await browser.newContext()
  const creatorPage = await creatorContext.newPage()
  const partnerPage = await partnerContext.newPage()

  await signInThroughUi(creatorPage, creator.email, creator.password, '/discover')
  await expect(creatorPage).toHaveURL(/\/discover$/)
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
  await expect(creatorPage.getByRole('heading', { name: /Choose privately. Match on the locations you both want/i })).toBeVisible()

  await signInThroughUi(partnerPage, partner.email, partner.password, roomPath)
  await expect(partnerPage).toHaveURL(new RegExp(`${escapePattern(roomPath)}$`))
  await expect(partnerPage.getByRole('heading', { name: /Choose privately. Match on the locations you both want/i })).toBeVisible()

  const creatorTitle = await creatorPage.locator('.date-swipe-card h2').innerText()
  const partnerTitle = await partnerPage.locator('.date-swipe-card h2').innerText()
  expect(partnerTitle).toBe(creatorTitle)

  await saveCurrentCard(creatorPage, 'This feels cozy and easy to talk in.')
  await expect(creatorPage.getByText(new RegExp(`Saved privately · ${escapePattern(creatorTitle)}`))).toBeVisible()
  await expect(creatorPage.getByText(/It’s a DateMatch/i)).toHaveCount(0)

  await saveCurrentCard(partnerPage, 'I love this one too.')
  const partnerMatch = partnerPage.getByRole('dialog')
  await expect(partnerMatch.getByRole('heading', { name: new RegExp(`You both saved ${escapePattern(creatorTitle)}`, 'i') })).toBeVisible()
  await expect(partnerMatch.getByText(/This feels cozy and easy to talk in/i)).toBeVisible()

  const creatorMatch = creatorPage.getByRole('dialog')
  await expect(creatorMatch.getByRole('heading', { name: new RegExp(`You both saved ${escapePattern(creatorTitle)}`, 'i') })).toBeVisible({ timeout: 20_000 })
  await expect(creatorMatch.getByText(/I love this one too/i)).toBeVisible()
  await expect(creatorMatch.getByRole('button', { name: /Plan this date/i })).toBeVisible()
  await expect(creatorMatch.getByRole('button', { name: /Keep swiping/i })).toBeVisible()

  await creatorContext.close()
  await partnerContext.close()
})
