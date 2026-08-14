import { createServer } from 'node:http'
import { access, open, readFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { chromium } from 'playwright'

const root = process.cwd()
const publicRoot = resolve(root, 'public')
const publicPrefix = `${publicRoot}${sep}`
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
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

await new Promise((resolveListening) => server.listen(0, '127.0.0.1', resolveListening))
const address = server.address()
const baseUrl = `http://127.0.0.1:${address.port}/`
const browser = await chromium.launch({ headless: true })

async function waitForCardTitle(page, expected) {
  await page.waitForFunction((title) => document.querySelector('#hero-deck .event-card:last-child h3')?.textContent?.trim() === title, expected)
}

async function assertDeckVisible(page, label) {
  await page.waitForFunction(() => document.querySelectorAll('#hero-deck .event-card').length === 3)
  const card = page.locator('#hero-deck .event-card:last-child')
  const box = await card.boundingBox()
  assert(box && box.width > 200 && box.height > 300, `${label}: top Figma location card is not visible`)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  assert(overflow <= 2, `${label}: page horizontally overflows by ${overflow}px`)
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()) })

  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await assertDeckVisible(page, 'desktop')
  await waitForCardTitle(page, 'Moonlight Café')
  assert(await page.title() === 'Puddle — discover places together', 'Figma landing browser title is missing')
  assert((await page.locator('.hero-copy h1').textContent())?.includes('Discover places.'), 'Figma landing hero promise is missing')
  assert((await page.locator('.hero-copy h1').textContent())?.includes('See who’s there.'), 'Figma landing social promise is missing')
  assert(await page.locator('.feature-card').count() === 4, 'four Figma feature panels are required')
  assert(await page.locator('.phone-shell').count() === 1, 'Figma phone preview is missing')
  assert(await page.locator('#social').count() === 0, 'retired generic social section remains')
  assert(await page.locator('#organizers').count() === 0, 'retired organizer section remains')
  assert(await page.locator('.section--tickets').count() === 0, 'retired ticketing section remains')
  assert(await page.locator('#app-demo').count() === 0, 'retired demo overlay remains')
  assert(await page.locator('#toast-region').count() === 0, 'retired toast region remains')

  for (const path of ['/signin', '/signup', '/privacy', '/terms']) {
    assert(await page.locator(`a[href="${path}"]`).count() > 0, `${path} native route link is missing`)
  }

  const footerForm = page.locator('.footer-form')
  assert(await footerForm.getAttribute('action') === '/signup', 'footer form does not submit to signup')
  assert((await footerForm.getAttribute('method'))?.toLowerCase() === 'get', 'footer form is not a native GET form')
  assert(await footerForm.locator('input[name="email"]').count() === 1, 'footer form email field is missing')

  await page.locator('[data-swipe="right"]').first().click()
  await waitForCardTitle(page, 'Clay & Cabernet')
  await page.locator('[data-swipe="left"]').click()
  await waitForCardTitle(page, 'Rooftop Cinema Club')
  await page.locator('[data-swipe="undo"]').click()
  await waitForCardTitle(page, 'Clay & Cabernet')

  const safetyButton = page.locator('[data-open-modal="safety"]').first()
  assert(await safetyButton.count() === 1, 'Figma safety details button is missing')
  await safetyButton.click()
  await page.waitForSelector('#modal-backdrop.is-open')
  assert((await page.locator('#modal-title').textContent())?.trim() === 'Shared places first. Privacy controls always.', 'current safety modal copy is missing')
  await page.locator('[data-close-modal]').click()
  await page.waitForSelector('#modal-backdrop', { state: 'hidden' })

  await page.locator('.menu-button').click()
  assert((await page.locator('#site-header').getAttribute('class'))?.includes('menu-open'), 'Figma header menu did not open')
  assert(await page.locator('.header-actions a[href="/signin"]').count() === 1, 'menu Sign in action is missing')
  assert(await page.locator('.header-actions a[href="/signup"]').count() === 1, 'menu Create account action is missing')

  for (const viewport of [
    { width: 1024, height: 768, label: 'laptop' },
    { width: 768, height: 1024, label: 'tablet' },
    { width: 390, height: 844, label: 'mobile' },
    { width: 360, height: 640, label: 'small mobile' }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await assertDeckVisible(page, viewport.label)
    assert((await page.locator('.hero-copy h1').textContent())?.includes('Discover places.'), `${viewport.label}: Figma headline is missing`)
  }

  const privacySource = await readFile(join(root, 'app/privacy/page.js'), 'utf8')
  const termsSource = await readFile(join(root, 'app/terms/page.js'), 'utf8')
  for (const marker of ['Information we collect', 'Location and recommendation controls', 'Your choices and privacy rights']) assert(privacySource.includes(marker), `privacy page is missing ${marker}`)
  for (const marker of ['Paid subscriptions and billing', 'Acceptable use', 'Governing law and disputes']) assert(termsSource.includes(marker), `terms page is missing ${marker}`)

  for (const removed of ['index.html','styles.css','app.js','public/landing-demo.js']) {
    try { await access(join(root, removed)); throw new Error(`${removed} still exists`) } catch (error) { if (error?.code !== 'ENOENT') throw error }
  }

  assert(pageErrors.length === 0, `browser errors detected:\n${pageErrors.join('\n')}`)
  console.log('Official Figma landing, native auth/legal links, responsive cards, menu, modal, and swipe interactions passed.')
} finally {
  await browser.close()
  await new Promise((resolveClosing) => server.close(resolveClosing))
}
