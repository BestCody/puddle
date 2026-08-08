import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chromium } from '@playwright/test'
import { createAdminClient } from '../lib/supabase/admin.js'

const baseUrl = String(process.env.LIVE_BASE_URL || '').replace(/\/$/, '')
if (!baseUrl) throw new Error('LIVE_BASE_URL is required.')

function uniqueValue(prefix) {
  return `${prefix}-${Date.now()}-${randomUUID().replaceAll('-', '').slice(0, 10)}`
}

async function googleFallbackCandidates(admin) {
  const mappings = await admin
    .from('location_google_places')
    .select('location_id,google_place_id,status')
    .eq('status', 'verified')
    .limit(200)
  if (mappings.error) throw mappings.error
  const ids = [...new Set((mappings.data || []).map((row) => row.location_id).filter(Boolean))]
  if (!ids.length) return []

  const locations = await admin
    .from('locations')
    .select('id,name,status,visibility')
    .in('id', ids)
    .eq('status', 'published')
    .eq('visibility', 'public')
  if (locations.error) throw locations.error

  const publicIds = (locations.data || []).map((row) => row.id)
  if (!publicIds.length) return []
  const photos = await admin
    .from('location_photo_sources')
    .select('location_id')
    .in('location_id', publicIds)
    .eq('status', 'approved')
    .eq('is_ai_generated', false)
  if (photos.error) throw photos.error

  const withOpenPhoto = new Set((photos.data || []).map((row) => row.location_id))
  const locationById = new Map((locations.data || []).map((row) => [row.id, row]))
  return (mappings.data || [])
    .filter((row) => locationById.has(row.location_id) && !withOpenPhoto.has(row.location_id))
    .map((row) => ({ ...row, name: locationById.get(row.location_id)?.name || null }))
}

async function cleanupAccount(page) {
  try {
    const current = new URL(page.url())
    await page.goto(`${current.origin}/account`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const confirmation = page.getByLabel('Confirmation')
    if (!await confirmation.isVisible().catch(() => false)) return
    await confirmation.fill('DELETE')
    await page.getByRole('button', { name: 'Delete my account' }).click()
    await page.waitForLoadState('domcontentloaded').catch(() => {})
  } catch (error) {
    console.warn(`Cleanup failed: ${error.message}`)
  }
}

const admin = createAdminClient()
const candidates = await googleFallbackCandidates(admin)
assert.ok(candidates.length, 'No published verified Google fallback candidates without approved open photos were found.')
console.log(`Found ${candidates.length} Google-fallback candidates; testing up to 3.`)

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const email = `${uniqueValue('google-photo')}@example.com`
const password = `Puddle-${uniqueValue('Google')}-Aa1!`
const username = `google_${randomUUID().replaceAll('-', '').slice(0, 12)}`
let accountCreated = false

await page.route('**/api/location/search**', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      results: [{
        providerId: 'google-photo-toronto', city: 'Toronto', region: 'Ontario', country: 'Canada', countryCode: 'CA',
        latitude: 43.6532, longitude: -79.3832, timezone: 'America/Toronto', label: 'Toronto, Ontario, Canada'
      }]
    })
  })
})

const successes = []
try {
  await page.goto(`${baseUrl}/signup`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.getByLabel('Display name').fill('Google Photo Smoke')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: /Create my Puddle/i }).click()
  await page.waitForURL(/\/onboarding(?:\?|$)/, { timeout: 30_000 })
  accountCreated = true

  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Birth date').fill('19940615')
  await page.getByLabel('City or town').fill('Toronto')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByRole('listbox', { name: 'Location results' }).getByRole('option').first().click()
  await page.getByLabel('Search radius').fill('25')
  await page.getByLabel('Coffee shops').check()
  await page.getByLabel('Restaurants').check()
  await page.getByLabel('Galleries').check()
  await page.getByLabel('Your ideal date vibe').fill('Google fallback production smoke test.')
  await page.getByRole('button', { name: /Build my date deck/i }).click()
  await page.waitForURL(/\/discover(?:\?|$)/, { timeout: 45_000 })

  const tested = candidates.slice(0, 3)
  for (const candidate of tested) {
    const before = await admin
      .from('location_photo_sources')
      .select('id,provider,external_photo_id,remote_url')
      .eq('location_id', candidate.location_id)
    if (before.error) throw before.error

    const response = await context.request.get(`${baseUrl}/api/location-google-photo/${candidate.location_id}`, {
      timeout: 30_000,
      failOnStatusCode: false
    })
    const contentType = String(response.headers()['content-type'] || '').toLowerCase()
    const hasAttribution = Boolean(
      response.headers()['x-puddle-google-attributions'] ||
      response.headers()['x-puddle-google-maps-uri']
    )

    if (response.status() !== 200 || !contentType.startsWith('image/')) {
      const errorBody = (await response.text().catch(() => '')).slice(0, 1000)
      console.log(JSON.stringify({
        locationId: candidate.location_id,
        name: candidate.name,
        status: response.status(),
        contentType,
        hasAttribution,
        errorBody
      }))
      continue
    }

    const bytes = await response.body()
    assert.ok(bytes.length > 0, 'Google fallback returned an empty image.')
    assert.ok(hasAttribution, 'Google fallback image did not expose attribution metadata.')
    assert.match(String(response.headers()['cache-control'] || ''), /private/i)
    assert.match(String(response.headers()['cache-control'] || ''), /no-store/i)

    const after = await admin
      .from('location_photo_sources')
      .select('id,provider,external_photo_id,remote_url')
      .eq('location_id', candidate.location_id)
    if (after.error) throw after.error
    assert.deepEqual(after.data || [], before.data || [], 'Google fallback persisted photo identity or URL data.')

    const success = {
      locationId: candidate.location_id,
      name: candidate.name,
      status: response.status(),
      contentType,
      bytes: bytes.length,
      hasAttribution,
      cacheControl: response.headers()['cache-control'] || null
    }
    successes.push(success)
    console.log(`GOOGLE_FALLBACK_ACCEPTED ${JSON.stringify(success)}`)
  }

  assert.equal(successes.length, tested.length, `Only ${successes.length} of ${tested.length} tested Google fallback candidates returned production images.`)
} finally {
  if (accountCreated) await cleanupAccount(page)
  await browser.close()
}
