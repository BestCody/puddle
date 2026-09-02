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

async function layout(page, selector) {
  return page.locator(selector).evaluate((node) => {
    const style = getComputedStyle(node)
    const rect = node.getBoundingClientRect()
    return {
      position: style.position,
      display: style.display,
      transform: style.transform,
      width: rect.width,
      height: rect.height,
      top: rect.top + window.scrollY,
      left: rect.left + window.scrollX
    }
  })
}

async function assertNormalPageFlow(page, selectors) {
  let previousBottom = -Infinity
  for (const selector of selectors) {
    const box = await layout(page, selector)
    assert(box.position !== 'absolute' && box.position !== 'fixed', `${selector} is still page-positioned with ${box.position}`)
    assert(box.top >= previousBottom - 2, `${selector} overlaps or precedes the previous page section`)
    previousBottom = box.top + box.height
  }
}

const landingHtml = await readFile(join(publicRoot, 'landing.html'), 'utf8')
const landingCss = await readFile(join(publicRoot, 'landing.css'), 'utf8')
const appJs = await readFile(join(publicRoot, 'app.js'), 'utf8')
const lockSvg = await readFile(join(publicRoot, 'figma/assets/lock.svg'), 'utf8')
const heartSvg = await readFile(join(publicRoot, 'figma/assets/heart.svg'), 'utf8')

assert(!landingHtml.includes('/figma/landing-desktop.png'), 'production HTML must not render a desktop screenshot')
assert(!landingHtml.includes('/figma/landing-mobile.png'), 'production HTML must not render a mobile screenshot')
assert(landingHtml.includes('/landing.css?v=1'), 'consolidated landing stylesheet is not loaded')
assert(!landingHtml.includes('figma-landing-exact.css'), 'old exact-coordinate landing stylesheet is still loaded')
assert(!landingHtml.includes('figma-landing-v2.css'), 'old landing fidelity override is still loaded')
assert(landingHtml.includes('<input'), 'landing must contain real form controls')
assert(landingHtml.includes('feature-phone-demo'), 'landing phones must remain genuine interactive demos')
assert(!landingHtml.includes('/figma/assets/lock.png'), 'opaque legacy Lock PNG must never be used')
assert(lockSvg.includes('fill="none"'), 'Figma Lock SVG must remain transparent')
assert(heartSvg.includes('fill="none"'), 'Figma Heart SVG must remain transparent')
assert(!appJs.includes('fitLanding'), 'landing runtime still contains canvas-fit scaling')
assert(!appJs.includes('DESKTOP_WIDTH'), 'landing runtime still contains fixed native canvas dimensions')
assert(!appJs.includes('is-scrolled'), 'landing runtime must not reintroduce scroll-state page positioning')
assert(!landingCss.includes('scale('), 'landing stylesheet still scales the whole Figma canvas')

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
  assert(await page.locator('[data-figma-node="352:484"]').isVisible(), 'desktop Figma composition is not visible')
  assert(!(await page.locator('[data-figma-node="351:156"]').isVisible()), 'mobile composition should be hidden on desktop')
  assert(await page.locator('.landing-sticky-left').isVisible(), 'desktop left sign-in column is missing')
  assert(await page.locator('.landing-sticky-left .landing-login-form input:not([type="hidden"])').count() === 2, 'desktop login fields are not real inputs')
  assert(await page.locator('.auth-mode-switch').isVisible(), 'landing auth mode switch is missing')
  assert(await page.locator('.landing-signup-form').isHidden(), 'signup form should start hidden')
  await page.locator('.auth-mode-switch [data-auth-mode="signup"]').click()
  assert(await page.locator('.landing-signup-form').isVisible(), 'signup form did not open from the auth mode switch')
  assert(await page.locator('.landing-signup-form input:not([type="hidden"]):not([type="checkbox"])').count() === 3, 'signup form fields are incomplete')
  assert(await page.getByRole('button', { name: 'Create my Puddle' }).isVisible(), 'signup primary action is missing')
  assert(await page.getByRole('button', { name: 'Continue with Google' }).isVisible(), 'signup Google action is missing')
  const signupViewport = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await signupViewport.goto(baseUrl, { waitUntil: 'networkidle' })
  await signupViewport.evaluate(() => document.fonts?.ready)
  await signupViewport.waitForFunction(() => document.querySelector('.landing-stage--desktop')?.dataset.ready === 'true')
  await signupViewport.locator('.auth-mode-switch [data-auth-mode="signup"]').click()
  const signupSurface = await signupViewport.locator('.landing-sticky-left__canvas').boundingBox()
  const signupLastChoice = await signupViewport.locator('.landing-signup-form .auth-choice').last().boundingBox()
  assert(signupSurface && signupLastChoice && signupLastChoice.y + signupLastChoice.height <= signupSurface.y + signupSurface.height - 1, 'desktop signup actions are pressed against or below the viewport')
  await signupViewport.close()
  await page.locator('.auth-mode-switch [data-auth-mode="login"]').click()
  assert(await page.locator('.landing-login-form').isVisible(), 'login form did not return from the auth mode switch')
  assert(await page.locator('.landing-sticky-left .brand--desktop').isVisible(), 'Puddle brand is missing from the left column')
  assert(await page.locator('.feature-card--d-swipe .interactive-pill').isVisible(), 'Figma Interactive pill is missing from Swipe')
  assert(await page.locator('.feature-card--d-save .interactive-pill').isVisible(), 'Figma Interactive pill is missing from Save')
  assert(await page.locator('.feature-card--d-feed .interactive-pill').isVisible(), 'Figma Interactive pill is missing from Feed')
  assert(await page.locator('.feature-card--d-profile').count() === 0, 'desktop Profile card is not present in Figma 352:484')

  const stageStyle = await page.locator('.landing-stage--desktop').evaluate((node) => getComputedStyle(node).display)
  assert(stageStyle === 'grid', `desktop landing is not a two-column grid: ${stageStyle}`)
  const canvasStyle = await layout(page, '.landing-canvas--desktop')
  assert(canvasStyle.transform === 'none', `desktop canvas is still globally transformed: ${canvasStyle.transform}`)
  assert(canvasStyle.position !== 'absolute', 'desktop content canvas is still absolutely positioned')

  await assertNormalPageFlow(page, [
    '.hero--desktop',
    '.discovery--desktop',
    '.feature-card--d-swipe',
    '.feature-card--d-save',
    '.feature-card--d-feed',
    '.trust-heading--desktop',
    '.safety-panel--desktop',
    '.final-cta--desktop'
  ])

  const swipePhone = await page.locator('.feature-card--d-swipe .feature-phone-demo').boundingBox()
  assert(swipePhone && swipePhone.width > 250 && swipePhone.height > 500, 'interactive Swipe phone lost its real viewport')
  assert(await page.locator('.feature-card--d-swipe .feature-phone-demo__frame').count() === 1, 'interactive Swipe iframe is missing')
  assert(await page.locator('.trust-heading--desktop img').getAttribute('src') === '/figma/assets/lock.svg', 'desktop Lock must use Figma SVG')
  assert(await page.locator('.safety-panel--desktop .safety-heart').getAttribute('src') === '/figma/assets/heart.svg', 'desktop Heart must use Figma SVG')

  const stickyBefore = await page.locator('.landing-sticky-left__canvas').boundingBox()
  const loginBefore = await page.locator('.landing-sticky-left .login-panel').boundingBox()
  const swipeBefore = await page.locator('.feature-card--d-swipe').boundingBox()
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 1000) })
  await page.waitForFunction(() => Math.abs(window.scrollY - 1000) < 3)
  const stickyAfter = await page.locator('.landing-sticky-left__canvas').boundingBox()
  const loginAfter = await page.locator('.landing-sticky-left .login-panel').boundingBox()
  const swipeAfter = await page.locator('.feature-card--d-swipe').boundingBox()
  assert(stickyBefore && stickyAfter && Math.abs(stickyAfter.y - stickyBefore.y) < 2, 'CSS sticky sign-in canvas moved during right-content scroll')
  assert(loginBefore && loginAfter && Math.abs(loginAfter.y - loginBefore.y) < 2, 'left login content moved during right-content scroll')
  assert(swipeBefore && swipeAfter && swipeAfter.y < swipeBefore.y - 900, 'right content did not scroll independently of the sticky left column')

  const footer = page.locator('#footer-d')
  await footer.scrollIntoViewIfNeeded()
  assert(await footer.isVisible(), 'desktop full-width footer is not visible')
  const overlap = await page.evaluate(() => {
    const sticky = document.querySelector('.landing-sticky-left__canvas')?.getBoundingClientRect()
    const footer = document.querySelector('#footer-d')?.getBoundingClientRect()
    if (!sticky || !footer) return Infinity
    return Math.max(0, Math.min(sticky.bottom, footer.bottom) - Math.max(sticky.top, footer.top))
  })
  assert(overlap === 0, `sticky sign-in canvas overlaps full-width footer by ${overlap}px`)
  for (const label of ['Explore', 'Company', 'Connect']) assert(await footer.getByRole('heading', { name: label, exact: true }).isVisible(), `${label} footer column is not visible`)

  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'desktop page horizontally overflows')
  for (const route of ['/signup', '/privacy', '/terms']) assert(await page.locator(`a[href="${route}"]`).count() > 0, `${route} route link is missing`)
  assert(await page.locator('.safety-panel--desktop h2').textContent() === 'Over 30 million locations worldwide', 'desktop safety copy is not from the updated Figma frame')
  assert(await page.locator('.safety-panel--desktop .safety-post').count() === 4, 'desktop safety city cards are incomplete')
  assert(await page.locator('.safety-panel--desktop .safety-model-button').getAttribute('href') === '/places', 'desktop safety See all link is missing')
  assert(await page.locator('.footer-bottom-art--desktop').getAttribute('src') === '/figma/assets/footer-bottom-scenery-desktop.png', 'desktop footer must use the Figma scenic artwork')
  await page.screenshot({ path: join(artifacts, 'desktop-real-dom.png'), fullPage: true })

  await page.setViewportSize({ width: 704, height: 900 })
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts?.ready)
  await page.waitForFunction(() => document.querySelector('.landing-stage--mobile')?.dataset.ready === 'true')
  assert(await page.locator('[data-figma-node="351:156"]').isVisible(), 'mobile Figma composition is not visible')
  assert(!(await page.locator('[data-figma-node="352:484"]').isVisible()), 'desktop composition should be hidden on mobile')
  assert(!(await page.locator('.landing-sticky-left').isVisible()), 'desktop sticky pane leaked into mobile')
  assert(await page.locator('.feature-card--m-swipe .interactive-pill').isVisible(), 'mobile Swipe Interactive pill is missing')
  assert(await page.locator('.feature-card--m-profile').count() === 0, 'mobile Profile card is not part of the updated Figma composition')
  assert(await page.locator('.mobile-login-button').isVisible(), 'mobile Login action is missing')
  assert(await page.locator('.mobile-login-button').getAttribute('href') === '/signin', 'mobile Login action does not use the canonical sign-in route')
  assert(await page.locator('.safety-panel--mobile').isVisible(), 'mobile safety panel is not visible')
  assert(await page.locator('.safety-panel--mobile .safety-post').count() === 4, 'mobile safety city cards are incomplete')
  assert(await page.locator('.trust-heading--mobile img').getAttribute('src') === '/figma/assets/lock.svg', 'mobile Lock must use Figma SVG')
  assert(await page.locator('.footer-bottom-art--mobile').getAttribute('src') === '/figma/assets/footer-bottom-scenery-mobile.png', 'mobile footer must use the Figma scenic artwork')
  assert(await page.locator('.footer-wordmark--mobile').isVisible(), 'mobile footer wordmark is missing')
  const mobileCanvas = await layout(page, '.landing-canvas--mobile')
  assert(mobileCanvas.transform === 'none', `mobile canvas is still globally transformed: ${mobileCanvas.transform}`)
  assert(mobileCanvas.position !== 'absolute', 'mobile content canvas is still absolutely positioned')
  await assertNormalPageFlow(page, [
    '.hero--mobile',
    '.discovery--mobile',
    '.feature-card--m-swipe',
    '.feature-card--m-save',
    '.feature-card--m-feed',
    '.trust-heading--mobile',
    '.safety-panel--mobile',
    '.final-cta--mobile',
    '.site-footer--mobile'
  ])
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile page horizontally overflows')

  const hero = await page.locator('.hero--mobile').boundingBox()
  const landscape = await page.locator('.mobile-hero-photo--two').boundingBox()
  const brand = await page.locator('.brand--mobile').boundingBox()
  const title = await page.locator('#mobile-title').boundingBox()
  const phone = await page.locator('.hero-phone-composite--mobile').boundingBox()
  const login = await page.locator('.mobile-login-button').boundingBox()
  assert(hero && hero.height > 1000 && Math.abs(hero.width / hero.height - 704 / 1093) < .01, 'mobile hero no longer preserves Figma 351:156 local composition ratio')
  assert(await page.locator('.mobile-hero-photo--two').isVisible(), 'Figma blue landscape layer is hidden')
  assert(landscape && landscape.width > hero.width && landscape.y >= hero.y && landscape.y < hero.y + hero.height * .03, 'Figma blue landscape layer lost its local hero placement')
  assert(await page.locator('.brand--mobile').isVisible() && brand && brand.y > hero.y + hero.height * .03 && brand.y < hero.y + hero.height * .08, 'mobile Puddle brand is missing from the Figma hero')
  assert(await page.locator('#mobile-title').isVisible() && title && title.y > hero.y + hero.height * .08 && title.y < hero.y + hero.height * .16, 'mobile hero title is missing or displaced')
  assert(await page.locator('.hero-phone-composite--mobile').isVisible() && phone && phone.y > hero.y + hero.height * .2 && phone.y < hero.y + hero.height * .28, 'mobile phone is missing or displaced from the Figma hero')
  assert(await page.locator('.mobile-login-button').isVisible() && login && login.y > hero.y + hero.height * .9 && login.y < hero.y + hero.height, 'mobile Login action is missing or displaced from the Figma hero')

  await page.screenshot({ path: join(artifacts, 'mobile-real-dom.png'), fullPage: true })

  assert(errors.length === 0, `browser errors detected:\n${errors.join('\n')}`)
  console.log('Figma landing passed: semantic desktop split, row-constrained sticky sign-in, normal-flow sections, local responsive mobile hero, interactive phones, and zero global canvas scaling.')
} finally {
  await browser.close()
  await new Promise((resolveClosing) => server.close(resolveClosing))
}
