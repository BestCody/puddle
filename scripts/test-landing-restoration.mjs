import { createServer } from 'node:http'
import { mkdir, open, readFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { chromium } from 'playwright'

const root = process.cwd()
const publicRoot = resolve(root, 'public')
const publicPrefix = `${publicRoot}${sep}`
const artifacts = resolve(root, 'landing-artifacts')
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' }
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const near = (actual, expected, tolerance = 1.5) => Math.abs(actual - expected) <= tolerance

const server = createServer(async (request, response) => {
  let handle
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    const requestedPath = url.pathname === '/' ? 'landing.html' : url.pathname.replace(/^\/+/, '')
    const filePath = resolve(publicRoot, requestedPath)
    if (filePath !== publicRoot && !filePath.startsWith(publicPrefix)) throw new Error('Path escapes public root')
    handle = await open(filePath, 'r')
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('Not a file')
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    response.end(await handle.readFile())
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not found')
  } finally { await handle?.close() }
})

async function cssBox(page, selector) {
  return page.locator(selector).evaluate((node) => {
    const style = getComputedStyle(node)
    return {
      left: Number.parseFloat(style.left), top: Number.parseFloat(style.top),
      width: Number.parseFloat(style.width), height: Number.parseFloat(style.height)
    }
  })
}

function assertBox(box, expected, label) {
  for (const [key, value] of Object.entries(expected)) assert(near(box[key], value), `${label} ${key} ${box[key]} does not match revised Figma ${value}`)
}

const landingHtml = await readFile(join(publicRoot, 'landing.html'), 'utf8')
const lockSvg = await readFile(join(publicRoot, 'figma/assets/lock.svg'), 'utf8')
assert(!landingHtml.includes('/figma/landing-desktop.png'), 'production HTML must not render the full desktop Figma screenshot')
assert(!landingHtml.includes('/figma/landing-mobile.png'), 'production HTML must not render the full mobile Figma screenshot')
assert(landingHtml.includes('/figma-landing-v2.css'), 'revised Figma geometry stylesheet is not loaded')
assert(landingHtml.includes('<input'), 'landing must contain real form controls')
assert(landingHtml.includes('feature-card'), 'landing must contain real feature-card DOM')
assert(landingHtml.includes('site-footer'), 'landing must contain a real footer')
assert(landingHtml.includes('data-figma-profile-backdrop'), 'desktop Profile white continuation from Figma is missing')
assert(!landingHtml.includes('/figma/assets/lock.png'), 'opaque legacy Lock PNG must never be used')
assert((landingHtml.match(/\/figma\/assets\/lock\.svg/g) || []).length === 2, 'desktop and mobile must use the transparent Figma Lock SVG')
assert(lockSvg.includes('fill="none"'), 'Figma Lock SVG must remain transparent')
assert(lockSvg.includes('stroke="#000"'), 'Figma Lock SVG must retain the Figma black vector stroke')
assert(!/<rect\b/i.test(lockSvg), 'Figma Lock SVG must not acquire a background rectangle')

await mkdir(artifacts, { recursive: true })
await new Promise((resolveListening) => server.listen(0, '127.0.0.1', resolveListening))
const baseUrl = `http://127.0.0.1:${server.address().port}/`
const browser = await chromium.launch({ headless: true })

try {
  const page = await browser.newPage({ viewport: { width: 1281, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts?.ready)
  await page.waitForFunction(() => document.querySelector('.landing-stage--desktop')?.dataset.ready === 'true')

  assert(await page.title() === 'Puddle — Discover places. See who’s there.', 'landing title does not match Figma copy')
  assert(await page.locator('[data-figma-node="83:76"]').isVisible(), 'desktop real-DOM canvas is not visible')
  assert(!(await page.locator('[data-figma-node="161:116"]').isVisible()), 'mobile canvas should be hidden on desktop')
  assert(await page.locator('.login-panel input').count() === 2, 'desktop login fields are not real inputs')
  assert(await page.locator('.feature-card').count() === 8, 'desktop/mobile feature cards are missing from real DOM')

  assertBox(await cssBox(page, '.discovery--desktop .city-photo-wrap'), { left: 0, top: 860, width: 1291, height: 2449 }, 'desktop blue artwork')
  assertBox(await cssBox(page, '.discovery--desktop .discovery-fade'), { left: 298, top: 1291, width: 685, height: 3252 }, 'desktop feature column')
  assertBox(await cssBox(page, '.feature-card--d-swipe'), { left: 367, top: 1715, width: 550, height: 896 }, 'desktop Swipe card')
  assertBox(await cssBox(page, '.feature-card--d-save'), { left: 376, top: 2673, width: 550, height: 898 }, 'desktop Save card')
  assertBox(await cssBox(page, '.feature-card--d-feed'), { left: 378, top: 3630, width: 550, height: 898 }, 'desktop Feed card')
  const profileBackdrop = await cssBox(page, '.profile-backdrop--desktop')
  assertBox(profileBackdrop, { left: 298, top: 4543, width: 685, height: 971 }, 'desktop Profile backdrop')
  assertBox(await cssBox(page, '.feature-card--d-profile'), { left: 378, top: 4561, width: 550, height: 898 }, 'desktop Profile card')
  const lockBox = await cssBox(page, '.trust-heading--desktop img')
  assertBox(lockBox, { left: 594, top: 5557, width: 92.395, height: 92.395 }, 'desktop Lock')
  assert(profileBackdrop.top + profileBackdrop.height < lockBox.top, 'Profile white backdrop must stop before the Lock')
  const backgroundFidelity = await page.evaluate(() => {
    const backdrop = document.querySelector('.profile-backdrop--desktop')
    const trust = document.querySelector('.trust-heading--desktop')
    const lock = trust?.querySelector('img')
    return {
      profile: backdrop ? getComputedStyle(backdrop).backgroundColor : null,
      trust: trust ? getComputedStyle(trust).backgroundColor : null,
      lock: lock ? getComputedStyle(lock).backgroundColor : null,
      lockSrc: lock?.getAttribute('src') || null
    }
  })
  assert(backgroundFidelity.profile === 'rgb(255, 255, 255)', `Profile backdrop is ${backgroundFidelity.profile}, expected Figma white`)
  assert(backgroundFidelity.trust === 'rgba(0, 0, 0, 0)', `trust section introduced an unintended background: ${backgroundFidelity.trust}`)
  assert(backgroundFidelity.lock === 'rgba(0, 0, 0, 0)', `Lock introduced an unintended background: ${backgroundFidelity.lock}`)
  assert(backgroundFidelity.lockSrc === '/figma/assets/lock.svg', `Lock source regressed to ${backgroundFidelity.lockSrc}`)
  assertBox(await cssBox(page, '.safety-panel--desktop'), { left: 325, top: 5877, width: 631, height: 1530 }, 'desktop safety panel')
  assertBox(await cssBox(page, '.final-cta--desktop>a'), { left: 459, top: 7836, width: 363, height: 77 }, 'desktop CTA')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'desktop page horizontally overflows')

  for (const route of ['/signin', '/signup', '/privacy', '/terms']) assert(await page.locator(`a[href="${route}"]`).count() > 0, `${route} route link is missing`)
  await page.locator('.safety-panel--desktop [data-open-safety]').click()
  await page.waitForSelector('#safety-dialog-backdrop.is-open')
  await page.locator('[data-close-safety]').click()
  assert(!(await page.locator('#safety-dialog-backdrop').isVisible()), 'safety dialog did not close')
  await page.screenshot({ path: join(artifacts, 'desktop-real-dom.png'), fullPage: true })

  await page.setViewportSize({ width: 704, height: 900 })
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts?.ready)
  await page.waitForFunction(() => document.querySelector('.landing-stage--mobile')?.dataset.ready === 'true')
  assert(await page.locator('[data-figma-node="161:116"]').isVisible(), 'mobile real-DOM canvas is not visible')
  assert(!(await page.locator('[data-figma-node="83:76"]').isVisible()), 'desktop canvas should be hidden on mobile')
  assert(await page.locator('.feature-card--m-swipe').isVisible(), 'mobile Swipe card is not visible')
  assert(await page.locator('.safety-panel--mobile').isVisible(), 'mobile safety panel is not visible')
  assert(await page.locator('.trust-heading--mobile img').getAttribute('src') === '/figma/assets/lock.svg', 'mobile Lock must use transparent Figma SVG')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile page horizontally overflows')

  const jump = page.locator('.mobile-jump')
  assert(await jump.getAttribute('aria-hidden') === 'true', 'Jump In must start hidden before mobile scroll')
  await page.evaluate(() => window.scrollTo(0, 80))
  await page.waitForFunction(() => document.querySelector('.landing-canvas--mobile')?.classList.contains('is-scrolled'))
  assert(await jump.getAttribute('aria-hidden') === 'false', 'Jump In must fade in after mobile scroll')
  await page.waitForTimeout(350)
  assert(Number(await jump.evaluate((node) => getComputedStyle(node).opacity)) > .9, 'Jump In did not become visually visible after scroll')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(artifacts, 'mobile-real-dom.png'), fullPage: true })

  assert(errors.length === 0, `browser errors detected:\n${errors.join('\n')}`)
  console.log('Current Figma landing rendered as genuine DOM. Profile white continuation, transparent Lock, desktop/mobile geometry, routes, interactions, responsive overflow, and browser renders passed.')
} finally {
  await browser.close()
  await new Promise((resolveClosing) => server.close(resolveClosing))
}
