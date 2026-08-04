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
  assert(box && box.width > 200 && box.height > 300, `${label}: top date-location card is not visible`)
  const footerBox = await card.locator('.event-card__footer').boundingBox()
  assert(footerBox && footerBox.y + footerBox.height <= box.y + box.height + 2, `${label}: date-location card footer is clipped`)
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
  assert(await page.title() === 'Puddle — swipe for your next date spot', 'date-location browser title is missing')
  assert((await page.locator('.hero-copy h1').textContent())?.trim() === 'Find the date spot one swipe at a time.', 'date-location hero promise is missing')
  assert((await page.locator('.hero-lede').textContent())?.includes('Coffee shops, restaurants, parks'), 'date-location hero description is missing')
  assert(await page.locator('#social').count() === 0, 'generic social event section remains in the active landing page')
  assert(await page.locator('#organizers').count() === 0, 'organizer section remains in the active landing page')
  assert(await page.locator('.section--tickets').count() === 0, 'ticketing section remains in the active landing page')
  assert(await page.locator('#app-demo').count() === 0, 'unused application prototype remains in the active DOM')
  assert(await page.locator('#toast-region').count() === 0, 'toast region remains in the active DOM')

  const getStarted = page.locator('.hero-actions a[href="/signup"]')
  assert(await getStarted.count() === 1, 'Get Started CTA is missing')
  assert((await getStarted.textContent())?.trim().startsWith('Get Started'), 'Get Started CTA label is missing')
  assert(new URL(await getStarted.getAttribute('href'), baseUrl).pathname === '/signup', 'Get Started does not link to registration')

  const headerLinks = await page.locator('.header-actions a').evaluateAll((links) => links.map((link) => ({ label: link.textContent.trim(), href: new URL(link.href).pathname })))
  assert(headerLinks.some((link) => link.label === 'Sign In' && link.href === '/signin'), 'header Sign In link is missing')
  assert(headerLinks.some((link) => link.label.startsWith('Register') && link.href === '/signup'), 'header Register link is missing')

  const finalLinks = await page.locator('.final-cta__inner > div a').evaluateAll((links) => links.map((link) => ({ label: link.textContent.trim(), href: new URL(link.href).pathname })))
  assert(finalLinks.some((link) => link.label.startsWith('Register') && link.href === '/signup'), 'final Register link is missing')
  assert(finalLinks.some((link) => link.label === 'Sign In' && link.href === '/signin'), 'final Sign In link is missing')

  const companyLinks = await page.locator('.site-footer a').evaluateAll((links) => links.map((link) => ({ label: link.textContent.trim(), href: new URL(link.href).pathname })))
  assert(companyLinks.some((link) => link.label === 'Privacy' && link.href === '/privacy'), 'Privacy page link is missing')
  assert(companyLinks.some((link) => link.label === 'Terms' && link.href === '/terms'), 'Terms page link is missing')

  const footerForm = page.locator('.footer-form')
  assert(await footerForm.getAttribute('action') === '/signup', 'footer form does not submit to signup')
  assert((await footerForm.getAttribute('method'))?.toLowerCase() === 'get', 'footer form is not a native GET form')
  assert(await footerForm.locator('input[name="email"]').count() === 1, 'footer form email field is missing')

  await page.locator('[data-swipe="right"]').click()
  await waitForCardTitle(page, 'Clay & Cabernet')
  await page.locator('[data-swipe="left"]').click()
  await waitForCardTitle(page, 'Rooftop Cinema Club')
  await page.locator('[data-swipe="undo"]').click()
  await waitForCardTitle(page, 'Clay & Cabernet')

  const safetyButton = page.locator('[data-open-modal="safety"]').first()
  assert(await safetyButton.count() === 1, 'date-safety details button is missing')
  await safetyButton.click()
  await page.waitForSelector('#modal-backdrop.is-open')
  assert((await page.locator('#modal-title').textContent())?.trim() === 'Date ideas without stranger matching.', 'date-safety modal copy is missing')
  await page.locator('[data-close-modal]').click()
  await page.waitForSelector('#modal-backdrop:not(.is-open)')

  for (const viewport of [
    { width: 1024, height: 768, label: 'laptop' },
    { width: 768, height: 1024, label: 'tablet' },
    { width: 390, height: 844, label: 'mobile' },
    { width: 360, height: 640, label: 'small mobile' }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await assertDeckVisible(page, viewport.label)
    assert((await page.locator('.hero-copy h1').textContent())?.includes('Find the date spot'), `${viewport.label}: date-location headline is missing`)
  }

  const privacySource = await readFile(join(root, 'app/privacy/page.js'), 'utf8')
  const termsSource = await readFile(join(root, 'app/terms/page.js'), 'utf8')
  for (const marker of ['Information we collect', 'Location and social privacy', 'Your choices and rights']) assert(privacySource.includes(marker), `privacy page is missing ${marker}`)
  for (const marker of ['Acceptable use', 'Tickets, payments, refunds, and payouts', 'Governing law and disputes']) assert(termsSource.includes(marker), `terms page is missing ${marker}`)

  for (const removed of ['index.html','styles.css','app.js','public/landing-demo.js']) {
    try { await access(join(root, removed)); throw new Error(`${removed} still exists`) } catch (error) { if (error?.code !== 'ENOENT') throw error }
  }

  assert(pageErrors.length === 0, `browser errors detected:\n${pageErrors.join('\n')}`)
  console.log('Date-location landing, native auth/legal links, responsive cards, and swipe interactions passed.')
} finally {
  await browser.close()
  await new Promise((resolveClosing) => server.close(resolveClosing))
}
