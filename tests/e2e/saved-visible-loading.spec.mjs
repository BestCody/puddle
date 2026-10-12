import { test, expect } from '@playwright/test'
import { GLOBAL_LOCATION_FIXTURES } from './global-location-fixture.mjs'
import { admin, completeProfileDirect, createConfirmedUser, signInThroughApi } from './support.mjs'

test('Saved titles and links arrive with the page; only opened details load related places', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 560 })
  const account = await createConfirmedUser({ displayName: 'Saved Loading Tester' })
  const previewRequests = []
  const similarRequests = []
  const similarOutcomes = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/saved-page') previewRequests.push(url)
    if (url.pathname.endsWith('/similar')) similarRequests.push(url)
  })
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname.endsWith('/similar')) similarOutcomes.push(`failed:${request.failure()?.errorText}`)
  })
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.endsWith('/similar')) similarOutcomes.push(`response:${response.status()}`)
  })

  try {
    await completeProfileDirect(account.user.id, { display_name: 'Saved Loading Tester' })
    const { error: refsError } = await admin.from('location_refs').upsert(
      GLOBAL_LOCATION_FIXTURES.map((place) => ({ id: place.id, kind: 'global' }))
    )
    if (refsError) throw refsError
    const { error: indexError } = await admin.from('location_ref_search_index').upsert(
      GLOBAL_LOCATION_FIXTURES.map((place) => ({
        location_id: place.id, name: place.name, slug: place.slug, category: place.category, city: place.city,
        latitude: place.latitude, longitude: place.longitude
      }))
    )
    if (indexError) throw indexError
    const { error: savedError } = await admin.from('user_content_states').insert(
      GLOBAL_LOCATION_FIXTURES.map((place) => ({ profile_id: account.user.id, location_id: place.id, state: 'saved' }))
    )
    if (savedError) throw savedError

    await signInThroughApi(page, account.email, account.password, '/plans')
    const cards = page.getByTestId('saved-card')
    await expect(cards).toHaveCount(GLOBAL_LOCATION_FIXTURES.length)
    const last = cards.last()
    await expect(last.locator('h2 a')).toHaveAttribute('href', /\/plans\//)
    await expect(last.locator('h2')).not.toContainText('Saved place')
    expect(await last.evaluate((element) => element.getBoundingClientRect().top > innerHeight * 1.25)).toBe(true)
    expect(previewRequests).toHaveLength(0)

    await last.scrollIntoViewIfNeeded()
    await expect(last.locator('h2')).not.toContainText('Saved place')
    expect(previewRequests).toHaveLength(0)

    await cards.first().locator('[data-saved-morph-link]').first().click()
    await expect(page.getByRole('dialog', { name: /details/ })).toBeVisible()
    await expect(page.locator('.saved-inline-detail-main h1')).toBeVisible()
    const similar = page.locator('.saved-inline-detail-similar')
    await expect(similar).toBeAttached()
    expect(await similar.evaluate((element) => element.getBoundingClientRect().top > innerHeight * 1.25)).toBe(true)
    expect(similarRequests).toHaveLength(0)

    const map = page.locator('.saved-inline-detail-map')
    expect(await map.evaluate((element) => element.getBoundingClientRect().top > innerHeight * 1.25)).toBe(true)
    await expect(map.locator('.location-map-tiles')).toHaveCount(0)
    await map.scrollIntoViewIfNeeded()
    await expect(map.locator('.location-map-tiles')).toBeVisible()

    // The section unmounts when the fixture has no related places, so scroll
    // its stable container rather than racing the section's removal.
    await page.locator('.saved-inline-detail-card').evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect.poll(() => similarOutcomes.filter((outcome) => outcome === 'response:200').length).toBe(1)
    expect(similarRequests.length - similarOutcomes.filter((outcome) => outcome.startsWith('failed:')).length).toBe(1)
    await page.locator('.saved-inline-detail-close').click()
    await expect(page.getByRole('dialog', { name: /details/ })).toHaveCount(0)
  } finally {
    await admin.from('user_content_states').delete().eq('profile_id', account.user.id)
    await admin.auth.admin.deleteUser(account.user.id)
  }
})
