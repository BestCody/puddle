import { test, expect } from '@playwright/test'
import { admin, completeProfileDirect, createConfirmedUser, signInThroughUi } from './support.mjs'

test('an onboarded user can create event and place drafts', async ({ page }) => {
  const account = await createConfirmedUser({ displayName: 'Creator Test' })
  await completeProfileDirect(account.user.id)
  await signInThroughUi(page, account.email, account.password)
  await expect(page).toHaveURL(/\/discover$/)

  await page.goto('/create/event')
  await expect(page.getByRole('heading', { name: /Build the whole plan/i })).toBeVisible()
  await page.getByLabel('Event title').fill('Automated Puddle Night')
  await page.getByLabel('Starts').fill('2030-06-15T19:00')
  await page.getByLabel('Ends').fill('2030-06-15T21:00')
  await page.getByLabel('Short summary').fill('Created by the full browser test suite.')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page).toHaveURL(/\/studio\/events\/[0-9a-f-]+\?success=/i)
  await expect(page.getByText(/Event draft saved/i)).toBeVisible()

  const { data: events, error: eventError } = await admin
    .from('events')
    .select('id,title,status,created_by')
    .eq('created_by', account.user.id)
    .eq('title', 'Automated Puddle Night')
  if (eventError) throw eventError
  expect(events).toHaveLength(1)
  expect(events[0].status).toBe('draft')

  await page.goto('/create/place')
  await expect(page.getByRole('heading', { name: /Put a local gem on Puddle/i })).toBeVisible()
  await page.getByLabel('Location name').fill('Automated Moonlight Cafe')
  await page.getByLabel('City').fill('Toronto')
  await page.getByLabel('Short summary').fill('A reliable test location draft.')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page).toHaveURL(/\/studio\/places\/[0-9a-f-]+\?success=/i)
  await expect(page.getByText(/Location draft saved/i)).toBeVisible()

  const { data: locations, error: locationError } = await admin
    .from('locations')
    .select('id,name,status,created_by')
    .eq('created_by', account.user.id)
    .eq('name', 'Automated Moonlight Cafe')
  if (locationError) throw locationError
  expect(locations).toHaveLength(1)
  expect(locations[0].status).toBe('draft')
})