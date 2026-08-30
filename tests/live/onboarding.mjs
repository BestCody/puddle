import { expect } from '@playwright/test'

// Onboarding is a five-step widget. Every step stays mounted so one submit still carries the
// whole payload, which means a field on a later step resolves in the DOM but is not visible.
// Filling straight through is what broke the live smoke suite: `City or town` matched an element
// on step 2 and then timed out waiting for it to become fillable.
//
// The three live specs shared one copy of this flow each. Keeping it here means the next change
// to the widget breaks one file rather than three.
const STEP_COUNT = 5

export async function completeOnboarding(page, {
  username,
  birthDate = '1990-01-01',
  city = 'Toronto',
  categories = ['Coffee shops', 'Restaurants', 'Parks & gardens']
} = {}) {
  const next = page.getByRole('button', { name: 'Next step' })

  // Step 1 - introduce yourself. Display name arrives from signup.
  await page.locator('input[name="username"]').fill(username)
  await page.locator('input[name="birth_date"]').fill(birthDate)
  await expect(next).toBeEnabled()
  await next.click()

  // Step 2 - where are you from. The picker only commits coordinates once a result is chosen,
  // and the step will not advance without them.
  await page.getByLabel('City or town').fill(city)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByRole('option').filter({ hasText: city }).first().click()
  await expect(next).toBeEnabled()
  await next.click()

  // Step 3 - travel distance. It defaults to 10 km, which already satisfies the step.
  await expect(next).toBeEnabled()
  await next.click()

  // Step 4 - at least three categories, or the step will not release.
  for (const category of categories) {
    await page.getByRole('checkbox', { name: category }).check()
  }
  await expect(next).toBeEnabled()
  await next.click()

  // Step 5 - vibe is optional, so this step submits the whole form. The button is "Finish setup";
  // the old single-page form called it "Build my date deck", which is the other reason these
  // specs could not have passed against the widget.
  await expect(page.getByRole('progressbar', { name: `Step ${STEP_COUNT} of ${STEP_COUNT}` })).toBeVisible()
  await page.getByRole('button', { name: 'Finish setup' }).click()
  await page.waitForURL(/\/discover(?:\?|$)/, { timeout: 30_000 })
}
