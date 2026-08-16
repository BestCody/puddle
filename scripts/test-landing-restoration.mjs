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
    return { left: Number.parseFloat(style.left), top: Number.parseFloat(style.top), width: Number.parseFloat(style.width), height: Number.parseFloat(style.height), display: style.display }
  })
}

function assertBox(box, expected, label) {
  for (const [key, value] of Object.entries(expected)) assert(near(box[key], value), `${label} ${key} ${box[key]} does not match current Figma ${value}`)
}

const landingHtml = await readFile(join(publicRoot, 'landing.html'), 'utf8')
const lockSvg = await readFile(join(publicRoot, 'figma/assets/lock.svg'), 'utf8')
const heartSvg = await readFile(join(publicRoot, 'figma/assets/heart.svg'), 'utf8')
assert(!landingHtml.includes('/figma/landing-desktop.png'), 'production HTML must not render the full desktop Figma screenshot')
assert(!landingHtml.includes('/figma/landing-mobile.png'), 'production HTML must not render the full mobile Figma screenshot')
assert(landingHtml.includes('/figma-landing-v2.css'), 'current Figma geometry stylesheet is not loaded')
assert(landingHtml.includes('<input'), 'landing must contain real form controls')
assert(landingHtml.includes('feature-phone-demo'), 'landing phones must remain genuine interactive demos')
assert(!landingHtml.includes('/figma/assets/lock.png'), 'opaque legacy Lock PNG must never be used')
assert(lockSvg.includes('fill="none"'), 'Figma Lock SVG must remain transparent')
assert(heartSvg.includes('fill="none"'), 'Figma Heart SVG must remain transparent')

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
  assert(await page.locator('.landing-sticky-left').isVisible(), 'desktop pinned left panel is missing')
  assert(await page.locator('.landing-sticky-left .login-panel input').count() === 2, 'desktop pinned login fields are not real inputs')
  assert(await page.locator('.landing-sticky-left .brand--desktop').isVisible(), 'Puddle brand did not move into pinned left pane')

  const canvasNativeHeight = await page.locator('.landing-canvas--desktop').getAttribute('data-native-height')
  assert(canvasNativeHeight === '7578', `desktop canvas runtime height is ${canvasNativeHeight}, expected current Figma 7578`)
  assert((await cssBox(page, '.discovery--desktop .city-photo-wrap')).display === 'none', 'obsolete city artwork from the previous Figma is still visible')
  assertBox(await cssBox(page, '.discovery--desktop h2'), { left: 711.755, top: 1413.622, width: 447.442 }, 'desktop discovery heading')
  assertBox(await cssBox(page, '.feature-card--d-swipe'), { left: 668.618, top: 1630.039, width: 535.595, height: 872.533 }, 'desktop Swipe card')
  assertBox(await cssBox(page, '.feature-card--d-save'), { left: 677.382, top: 2562.948, width: 535.595, height: 874.48 }, 'desktop Save card')
  assertBox(await cssBox(page, '.feature-card--d-feed'), { left: 679.33, top: 3494.883, width: 535.595, height: 874.48 }, 'desktop Feed card')
  assert(!(await page.locator('.feature-card--d-profile').isVisible()), 'desktop Profile card is not present in the current Figma and should be hidden')
  assert(await page.locator('.hero-phone-composite--desktop').isVisible(), 'current desktop Figma hero phone should be visible')

  const swipePhone = await page.locator('.feature-card--d-swipe .feature-phone-demo').boundingBox()
  assert(swipePhone && swipePhone.width > 300 && swipePhone.height > 700, 'interactive Swipe phone lost its real viewport')
  assert(await page.locator('.feature-card--d-swipe .feature-phone-demo__frame').count() === 1, 'interactive Swipe iframe is missing')

  assertBox(await cssBox(page, '.trust-heading--desktop img'), { left: 889.955, top: 4452, width: 89.976, height: 89.976 }, 'desktop Lock')
  assertBox(await cssBox(page, '.trust-heading--desktop h2'), { left: 679, top: 4554, width: 514.056 }, 'desktop trust title')
  assertBox(await cssBox(page, '.safety-panel--desktop'), { left: 628, top: 4763.619, width: 614.473, height: 1489.927 }, 'desktop safety panel')
  assertBox(await cssBox(page, '.final-cta--desktop>a'), { left: 758, top: 6708, width: 353.493, height: 74.983 }, 'desktop CTA')
  assertBox(await cssBox(page, '.site-footer--desktop'), { left: -9.305, top: 6792, width: 1291, height: 786 }, 'desktop footer')

  const fidelity = await page.evaluate(() => {
    const trust = document.querySelector('.trust-heading--desktop')
    const lock = trust?.querySelector('img')
    const heart = document.querySelector('.safety-panel--desktop .safety-heart')
    return {
      trust: trust ? getComputedStyle(trust).backgroundColor : null,
      lock: lock ? getComputedStyle(lock).backgroundColor : null,
      lockSrc: lock?.getAttribute('src') || null,
      heartContent: heart ? getComputedStyle(heart).content : null
    }
  })
  assert(fidelity.trust === 'rgba(0, 0, 0, 0)', `trust section introduced an unintended background: ${fidelity.trust}`)
  assert(fidelity.lock === 'rgba(0, 0, 0, 0)', `Lock introduced an unintended background: ${fidelity.lock}`)
  assert(fidelity.lockSrc === '/figma/assets/lock.svg', `Lock source regressed to ${fidelity.lockSrc}`)
  assert(fidelity.heartContent?.includes('heart.svg'), `Heart is not using the transparent Figma SVG: ${fidelity.heartContent}`)

  const stickyBefore = await page.locator('.landing-sticky-left').boundingBox()
  const loginBefore = await page.locator('.landing-sticky-left .login-panel').boundingBox()
  const swipeBefore = await page.locator('.feature-card--d-swipe').boundingBox()
  await page.evaluate(() => window.scrollTo(0, 1000))
  await page.waitForTimeout(80)
  const stickyAfter = await page.locator('.landing-sticky-left').boundingBox()
  const loginAfter = await page.locator('.landing-sticky-left .login-panel').boundingBox()
  const swipeAfter = await page.locator('.feature-card--d-swipe').boundingBox()
  assert(stickyBefore && stickyAfter && Math.abs(stickyAfter.y - stickyBefore.y) < 1, 'left pane moved while the page scrolled')
  assert(loginBefore && loginAfter && Math.abs(loginAfter.y - loginBefore.y) < 1, 'left login content moved while the right side scrolled')
  assert(swipeBefore && swipeAfter && swipeAfter.y < swipeBefore.y - 900, 'right-side Figma content did not scroll independently of the left pane')
  await page.evaluate(() => window.scrollTo(0, 0))

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
  assert(!(await page.locator('.landing-sticky-left').isVisible()), 'desktop pinned pane leaked into mobile')
  assert(await page.locator('.feature-card--m-swipe').isVisible(), 'mobile Swipe card is not visible')
  assert(await page.locator('.safety-panel--mobile').isVisible(), 'mobile safety panel is not visible')
  assert(await page.locator('.trust-heading--mobile img').getAttribute('src') === '/figma/assets/lock.svg', 'mobile Lock must use transparent Figma SVG')
  assert(await page.locator('.hero-phone-composite--mobile').evaluate((node) => getComputedStyle(node).display !== 'none'), 'mobile hero Phone must remain visible')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile page horizontally overflows')

  const jump = page.locator('.mobile-jump')
  assert(await jump.getAttribute('aria-hidden') === 'true', 'Jump In must start hidden before mobile scroll')
  await page.evaluate(() => window.scrollTo(0, 80))
  await page.waitForFunction(() => document.querySelector('.landing-canvas--mobile')?.classList.contains('is-scrolled'))
  assert(await jump.getAttribute('aria-hidden') === 'false', 'Jump In must fade in after mobile scroll')
  await page.waitForTimeout(350)
  assert(Number(await jump.evaluate((node) => getComputedStyle(node).opacity)) > .9, 'Jump In did not become visually visible after scroll')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: join(artifacts, 'mobile-real-dom.png'), fullPage: true })

  assert(errors.length === 0, `browser errors detected:\n${errors.join('\n')}`)
  console.log('Current Figma landing passed: pinned left desktop sign-in, independently scrolling right content, current 7578px geometry, genuine interactive phones, transparent glyphs, and unchanged mobile flow.')
} finally {
  await browser.close()
  await new Promise((resolveClosing) => server.close(resolveClosing))
}
