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
    class DetailsElement extends HTMLElement {
      connectedCallback() {
        window.setTimeout(() => this.dispatchEvent(new Event('gmp-load')), 0)
      }
    }
    if (!customElements.get('gmp-place-details-compact')) {
      customElements.define('gmp-place-details-compact', DetailsElement)
    }
    for (const name of [
      'gmp-place-details-place-request',
      'gmp-place-details-location-request',
      'gmp-place-content-config',
      'gmp-place-media',
      'gmp-place-attribution'
    ]) {
      if (!customElements.get(name)) customElements.define(name, class extends HTMLElement {})
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

  const actionBatches = []
  page.on('request', (request) => {
    if (!request.url().includes('/api/discovery/actions')) return
    actionBatches.push(request.postDataJSON()?.actions || [])
  })

  const card = page.locator('.minimal-swipe-card')
  await expect(card.locator('h1')).toHaveText('E2E Media Photo Cafe')
  await expect(page.locator('.minimal-swipe-photo')).toHaveAttribute('style', /e2e-media\.png/)
  await expect(page.locator('gmp-place-details-compact')).toHaveCount(0)

  await page.getByRole('button', { name: 'Pass' }).click()
  await expect(card.locator('h1')).toHaveText('E2E Media Google Museum')
  await expect.poll(() => page.evaluate(() => window.__e2eGoogleImports || [])).toContain('places')
  await expect(page.locator('gmp-place-details-compact')).toHaveCount(1)
  await expect(page.locator('gmp-place-details-location-request')).toHaveAttribute('location', /,/)

  await page.getByRole('button', { name: 'Pass' }).click()
  await expect(card.locator('h1')).toHaveText('E2E Media Placeholder Park')
  await expect(page.locator('gmp-place-details-compact')).toHaveCount(0)
  await expect.poll(() => actionBatches.flat().length).toBe(2)
  expect(actionBatches.every((batch) => batch.length > 0 && batch.length <= 20)).toBe(true)
  expect(actionBatches.flat().map((action) => action.action)).toEqual(['dismissed', 'dismissed'])
})

test('passing and undoing an R2 card uses compact action state without materializing a location', async ({ page }) => {
  const account = await createSwiper('R2 Pass Swiper')
  const candidates = [fixturePlaceBySourceId('e2e-pass-alpha'), fixturePlaceBySourceId('e2e-pass-beta')]
  await openFilteredDeck(page, account, 'E2E Pass')

  const heading = page.locator('.minimal-swipe-card h1')
  const firstTitle = await heading.innerText()
  const first = candidates.find((place) => place.name === firstTitle)
  const second = candidates.find((place) => place.name !== firstTitle)
  expect(first).toBeTruthy()
  expect(second).toBeTruthy()

  await page.getByRole('button', { name: 'Pass' }).click()
  await expect(heading).toHaveText(second.name)

  const dismissal = await poll(
    () => compactAction(account.user.id, first.id),
    { message: 'The compact static dismissal was not stored.' }
  )
  expect(Object.keys(dismissal).sort()).toEqual(['expires_at', 'location_id', 'user_id'])
  expect(new Date(dismissal.expires_at).getTime()).toBeGreaterThan(Date.now())
  expect(await locationRow(first.id)).toBeNull()

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(heading).toHaveText(first.name)
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

  const retention = await poll(async () => {
    const result = await admin
      .from('static_catalogue_materializations')
      .select('retention_class,expires_at')
      .eq('location_id', place.id)
      .single()
    if (result.error) throw result.error
    return result.data.retention_class === 'saved' ? result.data : null
  }, { timeout: 20_000, message: 'The saved static location did not receive permanent retention.' })
  expect(retention.retention_class).toBe('saved')
  expect(retention.expires_at).toBeNull()

  const diagnostics = await fetch(`${R2_FIXTURE_BASE_URL}/__requests`).then((response) => response.json())
  const catalogueReads = diagnostics.requests
    .map((entry) => entry.path)
    .filter((path) => path.includes('/catalogue/releases/'))
  const unexpected = catalogueReads.filter((path) => !path.endsWith('.json') || !path.includes('/e2e-static-v3/'))
  expect(unexpected).toEqual([])
})

test('opening full details reads the detail sidecar in-deck without materializing a location', async ({ page }) => {
  const account = await createSwiper('R2 Detail Swiper')
  const place = fixturePlaceBySourceId('e2e-detail-observatory')
  const openRequests = []
  page.on('request', (request) => {
    if (request.url().includes(`/api/static-catalogue/open/${place.id}`)) openRequests.push(request.url())
  })

  await openFilteredDeck(page, account, 'E2E Detail Observatory')
  const discoverUrl = page.url()
  const card = page.locator('.minimal-swipe-card')
  await card.click()

  const dialog = page.getByRole('dialog', { name: `Full details for ${place.name}` })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: place.name })).toBeVisible()
  await expect(dialog.locator('.minimal-details-location p')).toHaveText('77 Sidecar Lane')
  await expect(dialog.getByText('viewpoint')).toBeVisible()
  await expect(dialog.getByRole('link', { name: 'Full details' })).toHaveCount(0)
  await expect(dialog.getByRole('link', { name: 'Directions' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Pass' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /Perfect Pick/i })).toBeVisible()
  await expect(page).toHaveURL(discoverUrl)

  await page.waitForTimeout(500)
  expect(openRequests).toEqual([])
  expect(await locationRow(place.id)).toBeNull()
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