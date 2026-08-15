import { createServer } from 'node:http'
import { mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright'
import sharp from 'sharp'

const root = process.cwd()
const publicRoot = resolve(root, 'public')
const publicPrefix = `${publicRoot}${sep}`
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

function assert(condition, message) { if (!condition) throw new Error(message) }

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
    const body = await handle.readFile()
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    response.end(body)
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not found')
  } finally {
    await handle?.close()
  }
})

async function differenceRatio(referencePath, screenshotPath) {
  const reference = await sharp(referencePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const screenshot = await sharp(screenshotPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert(reference.info.width === screenshot.info.width && reference.info.height === screenshot.info.height,
    `pixel comparison dimensions differ: ${reference.info.width}x${reference.info.height} vs ${screenshot.info.width}x${screenshot.info.height}`)
  let changed = 0
  const pixels = reference.info.width * reference.info.height
  for (let offset = 0; offset < reference.data.length; offset += 4) {
    if (reference.data[offset] !== screenshot.data[offset] ||
        reference.data[offset + 1] !== screenshot.data[offset + 1] ||
        reference.data[offset + 2] !== screenshot.data[offset + 2] ||
        reference.data[offset + 3] !== screenshot.data[offset + 3]) changed += 1
  }
  return changed / pixels
}

await new Promise((resolveListening) => server.listen(0, '127.0.0.1', resolveListening))
const address = server.address()
const baseUrl = `http://127.0.0.1:${address.port}/`
const browser = await chromium.launch({ headless: true })
const temp = await mkdtemp(join(tmpdir(), 'puddle-figma-'))

try {
  const page = await browser.newPage({ viewport: { width: 1281, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  assert(await page.title() === 'Puddle — Discover places. See who’s there.', 'landing title does not match Figma copy')
  assert(await page.locator('[data-figma-node="83:76"]').isVisible(), 'desktop Figma artboard is not visible')
  assert(!(await page.locator('[data-figma-node="161:116"]').isVisible()), 'mobile Figma artboard should be hidden on desktop')
  const desktopNatural = await page.locator('.figma-artboard--desktop img').evaluate((img) => [img.naturalWidth, img.naturalHeight])
  assert(desktopNatural[0] === 1281 && desktopNatural[1] === 8736, `desktop export is ${desktopNatural.join('x')}, expected 1281x8736`)
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'desktop page horizontally overflows')

  const desktopShot = join(temp, 'desktop.png')
  await page.screenshot({ path: desktopShot, fullPage: true })
  const desktopDiff = await differenceRatio(join(publicRoot, 'figma/landing-desktop.png'), desktopShot)
  assert(desktopDiff < 0.0001, `desktop page differs from Figma export at ${(desktopDiff * 100).toFixed(4)}% of pixels`)

  for (const route of ['/signin', '/signup', '/privacy', '/terms']) {
    assert(await page.locator(`a[href="${route}"]`).count() > 0, `${route} native route link is missing`)
  }
  assert(await page.locator('[data-open-safety]').count() >= 2, 'safety-model hotspots are missing')
  await page.locator('.d-safety-button').click()
  await page.waitForSelector('#safety-dialog-backdrop.is-open')
  await page.locator('[data-close-safety]').click()
  assert(!(await page.locator('#safety-dialog-backdrop').isVisible()), 'safety dialog did not close')

  await page.setViewportSize({ width: 704, height: 900 })
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  assert(await page.locator('[data-figma-node="161:116"]').isVisible(), 'mobile Figma artboard is not visible')
  assert(!(await page.locator('[data-figma-node="83:76"]').isVisible()), 'desktop Figma artboard should be hidden on mobile')
  const mobileNatural = await page.locator('.figma-artboard--mobile img').evaluate((img) => [img.naturalWidth, img.naturalHeight])
  assert(mobileNatural[0] === 704 && mobileNatural[1] === 9660, `mobile export is ${mobileNatural.join('x')}, expected 704x9660`)
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile page horizontally overflows')
  assert(await page.locator('.mobile-jump-mask').evaluate((node) => getComputedStyle(node).opacity) === '1', 'Jump In should be hidden before the first mobile scroll')
  await page.evaluate(() => window.scrollTo(0, 1))
  await page.waitForTimeout(350)
  assert(await page.locator('.figma-artboard--mobile').evaluate((node) => node.classList.contains('has-scrolled')), 'Jump In was not revealed after mobile scroll')

  const mobileShot = join(temp, 'mobile.png')
  await page.screenshot({ path: mobileShot, fullPage: true })
  const mobileDiff = await differenceRatio(join(publicRoot, 'figma/landing-mobile.png'), mobileShot)
  assert(mobileDiff < 0.0001, `mobile page differs from Figma export at ${(mobileDiff * 100).toFixed(4)}% of pixels`)

  assert(errors.length === 0, `browser errors detected:\n${errors.join('\n')}`)
  console.log(`Exact Figma landing passed. Desktop diff ${(desktopDiff * 100).toFixed(5)}%; mobile diff ${(mobileDiff * 100).toFixed(5)}%.`)
} finally {
  await browser.close()
  await rm(temp, { recursive: true, force: true })
  await new Promise((resolveClosing) => server.close(resolveClosing))
}
