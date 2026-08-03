import { test, expect } from '@playwright/test'
import {
  admin,
  completeProfileDirect,
  createConfirmedUser,
  poll,
  signInThroughUi
} from './support.mjs'
import {
  R2_FIXTURE_BASE_URL,
  R2_FIXTURE_IDS,
  fixturePlaceBySourceId
} from './r2-fixture-data.mjs'

async function createSwiper(displayName) {
  const account = await createConfirmedUser({ displayName })
  await completeProfileDirect(account.user.id, {
    interests: ['cafe', 'gallery', 'restaurant', 'museum', 'park', 'scenic_spot', 'activity_venue'],
    search_radius_km: 25,
    profile_visibility: 'public'
  })
  return account
}

async function openFilteredDeck(page, account, query) {
  await signInThroughUi(page, account.email, account.password, '/discover')
  await expect(page).toHaveURL(/\/discover$/)
  await page.goto(`/discover?q=${encodeURIComponent(query)}`)
  await expect(page.locator('.minimal-swipe-card')).toBeVisible()
}

async function locationRow(id) {
  const result = await admin.from('locations').select('*').eq('id', id).maybeSingle()
  if (result.error) throw result.error
  return result.data
}

async function compactAction(userId, locationId) {
  const result = await admin
    .from('static_catalogue_actions')
    .select('*')
    .eq('user_id', userId)
    .eq('location_id', locationId)
    .maybeSingle()
  if (result.error) throw result.error
  return result.data
}

async function installGoogleUiKitStub(page) {
  await page.addInitScript(() => {
    class PassiveElement extends HTMLElement {}
    class DetailsElement extends HTMLElement {
      connectedCallback() {
        window.setTimeout(() => this.dispatchEvent(new Event('gmp-load')), 0)
      }
    }
    const definitions = [
      ['gmp-place-details-compact', DetailsElement],
      ['gmp-place-details-place-request', PassiveElement],
      ['gmp-place-content-config', PassiveElement],
      ['gmp-place-media', PassiveElement],
      ['gmp-place-attribution', PassiveElement]
    ]
    for (const [name, constructor] of definitions) {
      if (!customElements.get(name)) customElements.define(name, constructor)
    }
    window.google = {
      maps: {
        importLibrary: async (name) => {
          window.__e2eGoogleImports = [...(window.__e2eGoogleImports || []), name]
          return {}
        }
      }
    }
  })
}

test('R2 media overlays rank cached photos first and mount Google UI Kit only for the visible fallback card', async ({ page }) => {
  const account = await createSwiper('R2 Media Swiper')
  await installGoogleUiKitStub(page)
  await openFilteredDeck(page, account, 'E2E Media')

  const card = page.locator('.minimal-swipe-card')
  await expect(card.locator('h1')).toHaveText('E2E Media Photo Cafe')
  await expect(page.locator('.minimal-swipe-photo')).toHaveAttribute('style', /e2e-media\.png/)
  await expect(page.locator('gmp-place-details-compact')).toHaveCount(0)

  await page.getByRole('button', { name: 'Pass' }).click()
  await expect(card.locator('h1')).toHaveText('E2E Media Google Museum')
  await expect(page.locator('gmp-place-details-compact')).toHaveCount(1)
  await expect(page.locator('gmp-place-details-place-request')).toHaveAttribute('place', 'e2e-google-place-id')
  await expect.poll(() => page.evaluate(() => window.__e2eGoogleImports || [])).toContain('places')

  await page.getByRole('button', { name: 'Pass' }).click()
  await expect(card.locator('h1')).toHaveText('E2E Media Placeholder Park')
  await expect(page.locator('gmp-place-details-compact')).toHaveCount(0)
})

test('passing and undoing an R2 card uses compact action state without materializing a location', async ({ page }) => {
  const account = await createSwiper('R2 Pass Swiper')
  const first = fixturePlaceBySourceId('e2e-pass-alpha')
  await openFilteredDeck(page, account, 'E2E Pass')

  await expect(page.locator('.minimal-swipe-card h1')).toHaveText(first.name)
  await page.getByRole('button', { name: 'Pass' }).click()
  await expect(page.locator('.minimal-swipe-card h1')).toHaveText('E2E Pass Beta Gallery')

  const dismissal = await poll(
    () => compactAction(account.user.id, first.id),
    { message: 'The compact static dismissal was not stored.' }
  )
  expect(dismissal.action).toBe('dismissed')
  expect(new Date(dismissal.expires_at).getTime()).toBeGreaterThan(Date.now())
  expect(await locationRow(first.id)).toBeNull()

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.minimal-swipe-card h1')).toHaveText(first.name)
  await poll(async () => !(await compactAction(account.user.id, first.id)), {
    message: 'Undo did not remove the compact static dismissal.'
  })
  expect(await locationRow(first.id)).toBeNull()
})

test('saving an R2 card materializes its exact signed catalogue record and retains it as hot state', async ({ page }) => {
  const account = await createSwiper('R2 Save Swiper')
  const place = fixturePlaceBySourceId('e2e-save-bistro')
  await openFilteredDeck(page, account, 'E2E Save Bistro')
  await expect(page.locator('.minimal-swipe-card h1')).toHaveText(place.name)

  await fetch(`${R2_FIXTURE_BASE_URL}/__reset`, { method: 'POST' })
  await page.getByRole('button', { name: 'Save' }).click()

  const materialized = await poll(() => locationRow(place.id), {
    timeout: 20_000,
    message: 'The saved static place was not materialized.'
  })
  expect(materialized.name).toBe(place.name)
  expect(materialized.source).toBe('import')
  expect(materialized.source_metadata).toEqual({})

  const sourceLink = await admin
    .from('location_source_links')
    .select('source,source_place_id,location_id')
    .eq('location_id', place.id)
    .single()
  if (sourceLink.error) throw sourceLink.error
  expect(sourceLink.data).toMatchObject({ source: 'overture', source_place_id: place.sourcePlaceId, location_id: place.id })

  const retention = await admin
    .from('static_catalogue_materializations')
    .select('retention_class,expires_at')
    .eq('location_id', place.id)
    .single()
  if (retention.error) throw retention.error
  expect(retention.data.retention_class).toBe('saved')
  expect(retention.data.expires_at).toBeNull()

  const diagnostics = await fetch(`${R2_FIXTURE_BASE_URL}/__requests`).then((response) => response.json())
  const catalogueReads = diagnostics.requests
    .map((entry) => entry.path)
    .filter((path) => path.includes('/catalogue/releases/'))
  const unexpected = catalogueReads.filter((path) => !path.endsWith('.json') || !path.includes('/e2e-static-v2/'))
  expect(unexpected).toEqual([])
})

test('opening full details materializes the detail sidecar instead of bloating the deck tile', async ({ page }) => {
  const account = await createSwiper('R2 Detail Swiper')
  const place = fixturePlaceBySourceId('e2e-detail-observatory')
  await openFilteredDeck(page, account, 'E2E Detail Observatory')

  const card = page.locator('.minimal-swipe-card')
  await card.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: place.name })).toBeVisible()
  await dialog.getByRole('link', { name: 'Full details' }).click()
  await expect(page).toHaveURL(/\/places\/e2e-detail-observatory-[0-9a-f]{12}$/)

  const materialized = await poll(() => locationRow(place.id), {
    timeout: 20_000,
    message: 'Opening static details did not materialize the selected place.'
  })
  expect(materialized.address_public).toBe('77 Sidecar Lane')
  expect(materialized.opening_hours).toMatchObject({ monday: '09:00-17:00', friday: '09:00-20:00' })
  expect(materialized.accessibility).toMatchObject({ wheelchair_accessible: true, step_free: true })
  expect(materialized.website_url).toBe('https://example.com/e2e-observatory')

  const retention = await admin
    .from('static_catalogue_materializations')
    .select('retention_class,expires_at')
    .eq('location_id', place.id)
    .single()
  if (retention.error) throw retention.error
  expect(retention.data.retention_class).toBe('opened')
  expect(new Date(retention.data.expires_at).getTime()).toBeGreaterThan(Date.now())
})

test('account preference changes still shape the current location-first deck', async ({ page }) => {
  const account = await createSwiper('Preference Swiper')
  await openFilteredDeck(page, account, 'E2E Media')

  await page.goto('/account')
  await expect(page.getByRole('heading', { name: /Account settings/i })).toBeVisible()
  await page.getByLabel('Coffee shops').uncheck()
  await page.getByLabel('Galleries').uncheck()
  await page.getByLabel('Scenic spots').uncheck()
  await page.getByLabel('Restaurants').check()
  await page.getByLabel('Parks & gardens').check()
  await page.getByLabel('Activity dates').check()
  await page.getByRole('button', { name: /Save profile and date preferences/i }).click()
  await expect(page).toHaveURL(/\/account\?success=/)

  const profile = await poll(async () => {
    const result = await admin.from('profiles').select('interests').eq('id', account.user.id).single()
    if (result.error) throw result.error
    return result.data?.interests?.includes('activity_venue') ? result.data : null
  })
  expect(profile.interests).toEqual(expect.arrayContaining(['restaurant', 'park', 'activity_venue']))
})
