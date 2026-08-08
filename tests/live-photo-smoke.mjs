import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const baseUrl = String(process.env.LIVE_BASE_URL || '').replace(/\/$/, '')
if (!baseUrl) throw new Error('LIVE_BASE_URL is required.')

const diagnostics = {
  baseUrl,
  startedAt: new Date().toISOString(),
  resolverResponses: [],
  relationalPhotoResponses: [],
  googleProxyResponses: [],
  b2GrantRequests: [],
  b2PhotoResponses: [],
  googleRequests: [],
  googleResponses: [],
  consoleErrors: [],
  requestFailures: [],
  cards: []
}

function uniqueValue(prefix) {
  return `${prefix}-${Date.now()}-${randomUUID().replaceAll('-', '').slice(0, 10)}`
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value)
    for (const name of ['key', 'token', 'authorization', 'sessiontoken', 'ref']) {
      if (url.searchParams.has(name)) url.searchParams.set(name, '[redacted]')
    }
    return url.toString()
  } catch {
    return String(value).slice(0, 1000)
  }
}

function isGoogleUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'maps.googleapis.com' || hostname === 'places.googleapis.com' || hostname.endsWith('.googleapis.com')
  } catch {
    return false
  }
}

async function cardState(page) {
  return page.evaluate(() => {
    const card = document.querySelector('.minimal-swipe-card')
    const photo = card?.querySelector('.minimal-swipe-photo')
    const google = photo?.querySelector('.date-google-photo')
    const serverGoogle = photo?.querySelector('.date-google-server-photo')
    const serverImage = serverGoogle?.querySelector('img')
    const title = card?.querySelector('.minimal-swipe-title h1')?.textContent?.trim() || null
    const text = photo?.textContent || ''
    const backgroundImage = photo ? getComputedStyle(photo).backgroundImage : ''
    const googleReady = Boolean(google?.classList.contains('is-ready'))
    const serverGoogleReady = Boolean(serverGoogle?.classList.contains('is-ready'))
    const serverImageLoaded = Boolean(serverImage && serverImage.complete && serverImage.naturalWidth > 0 && serverImage.naturalHeight > 0)
    const comingSoon = /Real photo coming soon/i.test(text)
    const searching = /Finding a real photo|Loading a Google Maps photo|Photo search will retry/i.test(text)
    return {
      title,
      backgroundImage,
      googleReady,
      googleClass: google?.className || null,
      googleAriaLabel: google?.getAttribute('aria-label') || null,
      googleMountChildren: google?.querySelector('.date-google-photo-mount')?.childElementCount || 0,
      serverGoogleReady,
      serverGoogleClass: serverGoogle?.className || null,
      serverGoogleAriaLabel: serverGoogle?.getAttribute('aria-label') || null,
      serverImageLoaded,
      serverImageWidth: serverImage?.naturalWidth || 0,
      serverImageHeight: serverImage?.naturalHeight || 0,
      serverImageSourceKind: serverImage?.currentSrc?.startsWith('blob:') ? 'blob' : serverImage?.currentSrc ? 'other' : null,
      googleMapsAttributionVisible: Boolean(serverGoogle?.textContent?.includes('Google Maps')),
      comingSoon,
      searching
    }
  })
}

function isRenderedRealPhoto(state, resolverResponses, b2PhotoResponses, googleProxyResponses, relationalPhotoResponses) {
  const relationalOpenLoaded = relationalPhotoResponses.some((entry) =>
    entry.status >= 200 && entry.status < 300 && /^image\//i.test(entry.contentType || '')
  )
  if (relationalOpenLoaded && !state.comingSoon && state.backgroundImage && state.backgroundImage !== 'none') return true

  const proxiedGoogleLoaded = googleProxyResponses.some((entry) =>
    entry.status >= 200 && entry.status < 300 && /^image\//i.test(entry.contentType || '')
  )
  if (state.serverGoogleReady && state.serverImageLoaded && state.googleMapsAttributionVisible && proxiedGoogleLoaded && !state.comingSoon) return true
  if (state.googleReady && !state.comingSoon) return true
  const openFound = resolverResponses.some((entry) => entry.body?.state === 'open_photo_found')
  const b2Loaded = b2PhotoResponses.some((entry) => entry.status >= 200 && entry.status < 400)
  return Boolean(openFound && b2Loaded && !state.comingSoon && state.backgroundImage && state.backgroundImage !== 'none')
}

async function waitForCardOutcome(page, milliseconds = 18_000) {
  const started = Date.now()
  let latest = await cardState(page)
  while (Date.now() - started < milliseconds) {
    latest = await cardState(page)
    if (isRenderedRealPhoto(latest, diagnostics.resolverResponses, diagnostics.b2PhotoResponses, diagnostics.googleProxyResponses, diagnostics.relationalPhotoResponses)) {
      return { state: latest, rendered: true }
    }
    await page.waitForTimeout(500)
  }
  latest = await cardState(page)
  return {
    state: latest,
    rendered: isRenderedRealPhoto(latest, diagnostics.resolverResponses, diagnostics.b2PhotoResponses, diagnostics.googleProxyResponses, diagnostics.relationalPhotoResponses)
  }
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
    diagnostics.cleanupError = String(error?.message || error)
  }
}

await mkdir('test-results', { recursive: true })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const email = `${uniqueValue('live-photo')}@example.com`
const password = `Puddle-${uniqueValue('Photo')}-Aa1!`
const username = `live_${randomUUID().replaceAll('-', '').slice(0, 12)}`
let accountCreated = false

page.on('console', (message) => {
  if (message.type() === 'error') diagnostics.consoleErrors.push(message.text().slice(0, 1000))
})
page.on('requestfailed', (request) => {
  diagnostics.requestFailures.push({ url: safeExternalUrl(request.url()), error: request.failure()?.errorText || 'unknown' })
})
page.on('request', (request) => {
  const url = request.url()
  if (url.includes('/api/storage/b2-access?') && /(?:%2F|\/)photos(?:%2F|\/)open(?:%2F|\/)/i.test(url)) {
    diagnostics.b2GrantRequests.push(url.replace(/([?&]authorizationToken=)[^&]+/i, '$1[redacted]'))
  }
  if (isGoogleUrl(url)) diagnostics.googleRequests.push({ method: request.method(), url: safeExternalUrl(url) })
})
page.on('response', async (response) => {
  const url = response.url()
  if (url.includes('/api/static-catalogue/media/')) {
    let body = null
    try { body = await response.json() } catch {}
    diagnostics.resolverResponses.push({ url: safeExternalUrl(url), status: response.status(), body })
  }
  if (url.includes('/api/location-open-photo/')) {
    diagnostics.relationalPhotoResponses.push({
      url: safeExternalUrl(url),
      status: response.status(),
      contentType: response.headers()['content-type'] || null,
      provider: response.headers()['x-puddle-open-provider'] || null,
      cacheControl: response.headers()['cache-control'] || null
    })
  }
  if (url.includes('/api/static-catalogue/google-photo/') || url.includes('/api/location-google-photo/')) {
    diagnostics.googleProxyResponses.push({
      url: safeExternalUrl(url),
      status: response.status(),
      contentType: response.headers()['content-type'] || null,
      cacheControl: response.headers()['cache-control'] || null,
      hasAttribution: Boolean(response.headers()['x-puddle-google-attributions'] || response.headers()['x-puddle-google-maps-uri'])
    })
  }
  if (/\/photos\/open\//i.test(url) && !url.includes('/api/')) {
    diagnostics.b2PhotoResponses.push({ url: url.split('?')[0], status: response.status() })
  }
  if (isGoogleUrl(url)) diagnostics.googleResponses.push({ url: safeExternalUrl(url), status: response.status() })
})

await page.route('**/api/location/search**', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      results: [{
        providerId: 'live-photo-toronto', city: 'Toronto', region: 'Ontario', country: 'Canada', countryCode: 'CA',
        latitude: 43.6532, longitude: -79.3832, timezone: 'America/Toronto', label: 'Toronto, Ontario, Canada'
      }]
    })
  })
})

let success = false
let failure = null
try {
  await page.goto(`${baseUrl}/signup`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.getByLabel('Display name').fill('Live Photo Smoke')
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
  await page.getByLabel('Your ideal date vibe').fill('Live photo smoke test.')
  await page.getByRole('button', { name: /Build my date deck/i }).click()
  await page.waitForURL(/\/discover(?:\?|$)/, { timeout: 45_000 })
  await page.locator('.minimal-swipe-card').waitFor({ state: 'visible', timeout: 30_000 })

  for (let index = 0; index < 8; index += 1) {
    const beforeResolverCount = diagnostics.resolverResponses.length
    const beforeRelationalPhotoCount = diagnostics.relationalPhotoResponses.length
    const beforeProxyCount = diagnostics.googleProxyResponses.length
    const beforeB2Count = diagnostics.b2PhotoResponses.length
    const beforeGoogleRequestCount = diagnostics.googleRequests.length
    const beforeGoogleResponseCount = diagnostics.googleResponses.length
    const outcome = await waitForCardOutcome(page)
    diagnostics.cards.push({
      index,
      ...outcome.state,
      resolverResponses: diagnostics.resolverResponses.slice(beforeResolverCount),
      relationalPhotoResponses: diagnostics.relationalPhotoResponses.slice(beforeRelationalPhotoCount),
      googleProxyResponses: diagnostics.googleProxyResponses.slice(beforeProxyCount),
      b2PhotoResponses: diagnostics.b2PhotoResponses.slice(beforeB2Count),
      googleRequests: diagnostics.googleRequests.slice(beforeGoogleRequestCount),
      googleResponses: diagnostics.googleResponses.slice(beforeGoogleResponseCount)
    })
    await page.screenshot({ path: `test-results/live-photo-card-${index + 1}.png`, fullPage: true })
    if (outcome.rendered) {
      success = true
      break
    }
    const card = page.locator('.minimal-swipe-card').first()
    await card.press('ArrowLeft')
    await page.waitForTimeout(900)
    await page.locator('.minimal-swipe-card').waitFor({ state: 'visible', timeout: 15_000 })
  }

  assert.equal(success, true, `No real photo rendered across ${diagnostics.cards.length} live Discover cards.`)
} catch (error) {
  failure = error
  diagnostics.failure = String(error?.stack || error?.message || error)
  await page.screenshot({ path: 'test-results/live-photo-failure.png', fullPage: true }).catch(() => {})
} finally {
  if (accountCreated) await cleanupAccount(page)
  diagnostics.finishedAt = new Date().toISOString()
  diagnostics.success = success
  await writeFile('test-results/live-photo-diagnostics.json', JSON.stringify(diagnostics, null, 2))
  await context.close()
  await browser.close()
}

if (failure) throw failure