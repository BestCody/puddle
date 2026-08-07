import { test, expect } from '@playwright/test'
import { completeProfileDirect, createConfirmedUser, signInThroughUi } from './support.mjs'
import { R2_FIXTURE_BASE_URL, R2_FIXTURE_IDS } from './r2-fixture-data.mjs'

async function createRapidSwiper() {
  const account = await createConfirmedUser({ displayName: 'Rapid Media Swiper' })
  await completeProfileDirect(account.user.id, {
    interests: ['cafe'],
    search_radius_km: 25,
    profile_visibility: 'public'
  })
  return account
}

function rapidSourceId(title) {
  const match = String(title || '').match(/E2E Rapid Swipe (\d{2})/)
  return match ? `e2e-rapid-${match[1]}` : null
}

function p95(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] || 0
}

test('photo resolution sustains one-second swiping with bounded open-photo lookahead', async ({ page }) => {
  const account = await createRapidSwiper()
  const mediaRequests = []
  let activePrefetch = 0
  let maxActivePrefetch = 0

  await page.route('**/api/static-catalogue/media/**', async (route) => {
    const request = route.request()
    const body = request.postDataJSON() || {}
    const id = decodeURIComponent(new URL(request.url()).pathname.split('/').pop())
    const mode = body.mode || 'full'
    mediaRequests.push({ id, mode })

    if (mode === 'open_only') {
      activePrefetch += 1
      maxActivePrefetch = Math.max(maxActivePrefetch, activePrefetch)
      await new Promise((resolve) => setTimeout(resolve, 450))
      activePrefetch -= 1
    } else {
      await new Promise((resolve) => setTimeout(resolve, 80))
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        state: 'open_photo_found',
        photo_url: `${R2_FIXTURE_BASE_URL}/photos/e2e-media.png`,
        photo_provider: 'wikimedia-commons',
        photo_attribution: 'E2E Fixture · CC0',
        photo_attribution_url: 'https://example.com/e2e-photo-attribution',
        photo_license: 'CC0-1.0',
        has_real_photo: true,
        google_place_id: null,
        google_match_score: null
      })
    })
  })

  await signInThroughUi(page, account.email, account.password, '/discover')

  const heading = page.locator('.minimal-swipe-card h1')
  const photo = page.locator('.minimal-swipe-photo')
  const knownPhotoId = R2_FIXTURE_IDS['e2e-rapid-01']

  // A catalogue/media-overlay photo must pair directly with its location and make
  // zero resolver calls.
  await page.goto('/discover?q=E2E%20Rapid%20Swipe%2001')
  await expect(heading).toHaveText('E2E Rapid Swipe 01')
  expect(String(await photo.getAttribute('style'))).toContain('e2e-media.png')
  await page.waitForTimeout(200)
  expect(mediaRequests.filter((entry) => entry.id === knownPhotoId)).toHaveLength(0)

  await page.goto('/discover?q=E2E%20Rapid%20Swipe')
  await expect(heading).toContainText('E2E Rapid Swipe')

  // A real user typically spends about a second on the first card. Use that time
  // to warm the next three open-photo candidates before rapid swiping begins.
  await page.waitForTimeout(1_000)

  const transitionDurations = []
  const photoReadyDurations = []
  let revisit = null

  for (let index = 0; index < 6; index += 1) {
    const previousTitle = await heading.innerText()
    const started = Date.now()
    await page.getByRole('button', { name: 'Pass' }).click()
    await expect(heading).not.toHaveText(previousTitle)
    const transitioned = Date.now()
    const transitionMs = transitioned - started
    transitionDurations.push(transitionMs)
    expect(transitionMs).toBeLessThan(1_000)

    await expect.poll(async () => String(await photo.getAttribute('style') || '').includes('e2e-media.png'), {
      timeout: 500
    }).toBe(true)
    const photoReadyMs = Date.now() - transitioned
    photoReadyDurations.push(photoReadyMs)
    expect(photoReadyMs).toBeLessThan(500)

    if (index === 4) {
      const title = await heading.innerText()
      const sourceId = rapidSourceId(title)
      const id = sourceId ? R2_FIXTURE_IDS[sourceId] : null
      revisit = id ? {
        title,
        id,
        requests: mediaRequests.filter((entry) => entry.id === id).length
      } : null
    }

    const elapsed = Date.now() - started
    if (elapsed < 1_000) await page.waitForTimeout(1_000 - elapsed)
  }

  expect(p95(transitionDurations)).toBeLessThan(1_000)
  expect(p95(photoReadyDurations)).toBeLessThan(500)
  expect(maxActivePrefetch).toBeLessThanOrEqual(3)
  expect(mediaRequests.some((entry) => entry.mode === 'open_only')).toBe(true)
  expect(mediaRequests.filter((entry) => entry.id === knownPhotoId)).toHaveLength(0)

  // The previous warmed card should come back from the browser cache on Undo.
  if (revisit) {
    const beforeUndoCount = mediaRequests.filter((entry) => entry.id === revisit.id).length
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(heading).toHaveText(revisit.title)
    await page.waitForTimeout(250)
    const afterUndoCount = mediaRequests.filter((entry) => entry.id === revisit.id).length
    expect(afterUndoCount).toBe(beforeUndoCount)
  }
})
