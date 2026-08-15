import { createServer } from 'node:http'
import { copyFile, mkdir, open, readFile } from 'node:fs/promises'
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

async function differenceReport(referencePath, screenshotPath, bandSize = 1000) {
  const reference = await sharp(referencePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const screenshot = await sharp(screenshotPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert(reference.info.width === screenshot.info.width && reference.info.height === screenshot.info.height,
    `visual comparison dimensions differ: ${reference.info.width}x${reference.info.height} vs ${screenshot.info.width}x${screenshot.info.height}`)

  const { width, height } = reference.info
  let changed = 0
  let absoluteError = 0
  const bands = []
  for (let startY = 0; startY < height; startY += bandSize) bands.push({ startY, endY: Math.min(height, startY + bandSize), changed: 0, pixels: 0, absoluteError: 0 })

  for (let y = 0; y < height; y += 1) {
    const band = bands[Math.floor(y / bandSize)]
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      let pixelChanged = false
      for (let channel = 0; channel < 4; channel += 1) {
        const error = Math.abs(reference.data[offset + channel] - screenshot.data[offset + channel])
        absoluteError += error
        band.absoluteError += error
        if (error !== 0) pixelChanged = true
      }
      band.pixels += 1
      if (pixelChanged) { changed += 1; band.changed += 1 }
    }
  }

  const pixelCount = width * height
  return {
    ratio: changed / pixelCount,
    mae: absoluteError / (pixelCount * 4 * 255),
    bands: bands.map((band) => ({
      ...band,
      ratio: band.changed / band.pixels,
      mae: band.absoluteError / (band.pixels * 4 * 255)
    }))
  }
}

function printBands(label, report) {
  console.log(`${label} visual-difference bands:`)
  for (const band of report.bands) console.log(`  y=${band.startY}-${band.endY}: changed ${(band.ratio * 100).toFixed(3)}%, normalized MAE ${(band.mae * 100).toFixed(3)}%`)
}

const landingHtml = await readFile(join(publicRoot, 'landing.html'), 'utf8')
assert(!landingHtml.includes('/figma/landing-desktop.png'), 'production HTML must not render the full desktop Figma screenshot')
assert(!landingHtml.includes('/figma/landing-mobile.png'), 'production HTML must not render the full mobile Figma screenshot')
assert(landingHtml.includes('<input'), 'landing must contain real form controls')
assert(landingHtml.includes('feature-card'), 'landing must contain real feature-card DOM')
assert(landingHtml.includes('site-footer'), 'landing must contain a real footer')

await mkdir(artifacts, { recursive: true })
await copyFile(join(publicRoot, 'figma/landing-desktop.png'), join(artifacts, 'desktop-figma-reference.png'))
await copyFile(join(publicRoot, 'figma/landing-mobile.png'), join(artifacts, 'mobile-figma-reference.png'))
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
  const desktopReport = await differenceReport(join(publicRoot, 'figma/landing-desktop.png'), desktopShot)
  printBands('Desktop', desktopReport)

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
  const mobileReport = await differenceReport(join(publicRoot, 'figma/landing-mobile.png'), mobileShot)
  printBands('Mobile', mobileReport)

  assert(desktopReport.mae < 0.03, `desktop genuine frontend exceeds Figma fidelity budget: normalized MAE ${(desktopReport.mae * 100).toFixed(3)}%`)
  assert(mobileReport.mae < 0.035, `mobile genuine frontend exceeds Figma fidelity budget: normalized MAE ${(mobileReport.mae * 100).toFixed(3)}%`)
  assert(errors.length === 0, `browser errors detected:\n${errors.join('\n')}`)
  console.log(`Genuine Figma landing rendered as DOM. Desktop normalized MAE ${(desktopReport.mae * 100).toFixed(5)}% (raw changed pixels ${(desktopReport.ratio * 100).toFixed(5)}%); mobile normalized MAE ${(mobileReport.mae * 100).toFixed(5)}% (raw changed pixels ${(mobileReport.ratio * 100).toFixed(5)}%). Full-page Figma screenshots are regression references only, never rendered by the site.`)
} finally {
  await browser.close()
  await new Promise((resolveClosing) => server.close(resolveClosing))
}
