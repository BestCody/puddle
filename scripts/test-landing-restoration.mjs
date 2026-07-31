import { createServer } from 'node:http'
import { access, readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright'

const root = process.cwd()
const publicRoot = join(root, 'public')
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
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    const requestedPath = url.pathname === '/' ? '/landing.html' : url.pathname
    const safePath = normalize(requestedPath).replace(/^([.][.][/\\])+/, '')
    const filePath = join(publicRoot, safePath)
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error('Not a file')
    const body = await readFile(filePath)
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    response.end(body)
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not found')
  }
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const baseUrl = `http://127.0.0.1:${address.port}/`
const browser = await chromium.launch({ headless: true })

async function waitForTitle(page, expected) {
  await page.waitForFunction((title) => document.querySelector('#hero-deck .event-card:last-child h3')?.textContent?.trim() === title, expected)
}

async function assertDeckVisible(page, label) {
  await page.waitForFunction(() => document.querySelectorAll('#hero-deck .event-card').length === 3)
  const card = page.locator('#hero-deck .event-card:last-child')
  const box = await card.boundingBox()
  assert(box && box.width > 200 && box.height > 300, `${label}: top event card is not visible`)
  const footerBox = await card.locator('.event-card__footer').boundingBox()
  assert(footerBox && footerBox.y + footerBox.height <= box.y + box.height + 2, `${label}: event card footer is clipped`)
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
  await waitForTitle(page, 'Neon Garden')
  assert(await page.locator('#app-demo').count() === 0, 'unused application prototype remains in the active DOM')
  assert(await page.locator('#toast-region').count() === 0, 'toast region remains in the active DOM')

  const getStarted = page.locator('.hero-actions a')
  assert((await getStarted.textContent())?.trim().startsWith('Get Started'), 'Get Started CTA is missing')
  assert(new URL(await getStarted.getAttribute('href'), baseUrl).pathname === '/signup', 'Get Started does not link to registration')

  const finalLinks = await page.locator('.final-cta__inner > div a').evaluateAll((links) => links.map((link) => ({ label: link.textContent.trim(), href: new URL(link.href).pathname })))
  assert(finalLinks.some((link) => link.label.startsWith('Register') && link.href === '/signup'), 'final Register link is missing')
  assert(finalLinks.some((link) => link.label === 'Sign In' && link.href === '/signin'), 'final Sign In link is missing')

  const companyLinks = await page.locator('.site-footer a').evaluateAll((links) => links.map((link) => ({ label: link.textContent.trim(), href: new URL(link.href).pathname })))
  assert(companyLinks.some((link) => link.label === 'Privacy' && link.href === '/privacy'), 'Privacy page link is missing')
  assert(companyLinks.some((link) => link.label === 'Terms' && link.href === '/terms'), 'Terms page link is missing')

  await page.locator('[data-swipe="right"]').click()
  await waitForTitle(page, 'Clay & Cabernet')
  await page.locator('[data-swipe="left"]').click()
  await waitForTitle(page, 'Rooftop Cinema Club')

  await page.locator('.mini-like').first().click()
  assert(await page.locator('.mini-like').first().evaluate((button) => button.classList.contains('is-liked')), 'marketing like interaction failed')

  for (const type of ['organizer', 'safety']) {
    await page.locator(`[data-open-modal="${type}"]`).first().click()
    await page.waitForSelector('#modal-backdrop.is-open')
    assert((await page.locator('#modal-title').textContent())?.trim().length > 10, `${type}: modal content is missing`)
    await page.locator('[data-close-modal]').click()
    await page.waitForSelector('#modal-backdrop:not(.is-open)')
  }

  for (const viewport of [
    { width: 1024, height: 768, label: 'laptop' },
    { width: 768, height: 1024, label: 'tablet' },
    { width: 390, height: 844, label: 'mobile' },
    { width: 360, height: 640, label: 'small mobile' }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await assertDeckVisible(page, viewport.label)
  }

  const privacySource = await readFile(join(root, 'app/privacy/page.js'), 'utf8')
  const termsSource = await readFile(join(root, 'app/terms/page.js'), 'utf8')
  for (const marker of ['Information we collect', 'Location and social privacy', 'Your choices and rights']) assert(privacySource.includes(marker), `privacy page is missing ${marker}`)
  for (const marker of ['Acceptable use', 'Tickets, payments, refunds, and payouts', 'Governing law and disputes']) assert(termsSource.includes(marker), `terms page is missing ${marker}`)

  for (const removed of ['index.html','styles.css','app.js','public/landing-demo.js']) {
    try { await access(join(root, removed)); throw new Error(`${removed} still exists`) } catch (error) { if (error?.code !== 'ENOENT') throw error }
  }

  assert(pageErrors.length === 0, `browser errors detected:\n${pageErrors.join('\n')}`)
  console.log('Lean landing, legal links, responsive cards, and interaction tests passed.')
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
