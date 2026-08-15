import { createServer } from 'node:http'
import { mkdir, open, readFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import sharp from 'sharp'

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

async function differenceRatio(referencePath, screenshotPath) {
  const reference = await sharp(referencePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const screenshot = await sharp(screenshotPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert(reference.info.width === screenshot.info.width && reference.info.height === screenshot.info.height,
    `visual comparison dimensions differ: ${reference.info.width}x${reference.info.height} vs ${screenshot.info.width}x${screenshot.info.height}`)
  let changed = 0
  const pixels = reference.info.width * reference.info.height
  for (let offset = 0; offset < reference.data.length; offset += 4) {
    if (reference.data[offset] !== screenshot.data[offset] || reference.data[offset + 1] !== screenshot.data[offset + 1] || reference.data[offset + 2] !== screenshot.data[offset + 2] || reference.data[offset + 3] !== screenshot.data[offset + 3]) changed += 1
  }
  return changed / pixels
}

const landingHtml = await readFile(join(publicRoot, 'landing.html'), 'utf8')
assert(!landingHtml.includes('/figma/landing-desktop.png'), 'production HTML must not render the full desktop Figma screenshot')
assert(!landingHtml.includes('/figma/landing-mobile.png'), 'production HTML must not render the full mobile Figma screenshot')
assert(landingHtml.includes('<input'), 'landing must contain real form controls')
assert(landingHtml.includes('feature-card'), 'landing must contain real feature-card DOM')
assert(landingHtml.includes('site-footer'), 'landing must contain a real footer')

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
  assert(await page.getByRole('heading', { name: 'Discover places. See who’s there.', level: 1 }).isVisible(), 'desktop Figma headline is not real text')
  assert(await page.locator('.login-panel input').count() === 2, 'desktop login fields are not real inputs')
  assert(await page.locator('.feature-card').count() === 8, 'desktop/mobile feature cards are missing from real DOM')
  assert(await page.locator('.feature-card--d-swipe').isVisible(), 'desktop Swipe card is not visible')
  assert(await page.locator('.safety-panel--desktop').isVisible(), 'desktop safety panel is not visible')
  assert(await page.locator('.site-footer--desktop').isVisible(), 'desktop footer is not visible')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'desktop page horizontally overflows')

  const desktopShot = join(artifacts, 'desktop-real-dom.png')
  await page.screenshot({ path: desktopShot, fullPage: true })
  const desktopDiff = await differenceRatio(join(publicRoot, 'figma/landing-desktop.png'), desktopShot)

  for (const route of ['/signin', '/signup', '/privacy', '/terms']) assert(await page.locator(`a[href="${route}"]`).count() > 0, `${route} route link is missing`)
  await page.locator('.safety-panel--desktop [data-open-safety]').click()
  await page.waitForSelector('#safety-dialog-backdrop.is-open')
  await page.locator('[data-close-safety]').click()
  assert(!(await page.locator('#safety-dialog-backdrop').isVisible()), 'safety dialog did not close')

  await page.setViewportSize({ width: 704, height: 900 })
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts?.ready)
  await page.waitForFunction(() => document.querySelector('.landing-stage--mobile')?.dataset.ready === 'true')
  assert(await page.locator('[data-figma-node="161:116"]').isVisible(), 'mobile real-DOM canvas is not visible')
  assert(!(await page.locator('[data-figma-node="83:76"]').isVisible()), 'desktop canvas should be hidden on mobile')
  assert(await page.getByRole('heading', { name: 'Discover places. See who’s there.', level: 1 }).isVisible(), 'mobile Figma headline is not real text')
  assert(await page.locator('.mobile-jump').isVisible(), 'mobile Jump In control is not a real link')
  assert(await page.locator('.feature-card--m-swipe').isVisible(), 'mobile Swipe card is not visible')
  assert(await page.locator('.safety-panel--mobile').isVisible(), 'mobile safety panel is not visible')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile page horizontally overflows')

  const mobileShot = join(artifacts, 'mobile-real-dom.png')
  await page.screenshot({ path: mobileShot, fullPage: true })
  const mobileDiff = await differenceRatio(join(publicRoot, 'figma/landing-mobile.png'), mobileShot)

  assert(desktopDiff < 0.35, `desktop genuine frontend is still too far from Figma: ${(desktopDiff * 100).toFixed(3)}% changed pixels`)
  assert(mobileDiff < 0.35, `mobile genuine frontend is still too far from Figma: ${(mobileDiff * 100).toFixed(3)}% changed pixels`)
  assert(errors.length === 0, `browser errors detected:\n${errors.join('\n')}`)
  console.log(`Genuine Figma landing rendered as DOM. Desktop changed-pixel ratio ${(desktopDiff * 100).toFixed(5)}%; mobile ${(mobileDiff * 100).toFixed(5)}%. Full-page Figma screenshots are test references only, not rendered by the site.`)
} finally {
  await browser.close()
  await new Promise((resolveClosing) => server.close(resolveClosing))
}
