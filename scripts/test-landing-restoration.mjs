import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
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

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    const requestedPath = url.pathname === '/' ? '/landing.html' : url.pathname
    const safePath = normalize(requestedPath).replace(/^([.][.][/\\])+/, '')
    const filePath = join(publicRoot, safePath)
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error('Not a file')
    const body = await readFile(filePath)
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    })
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

async function waitForTitle(page, expected, deck = '#hero-deck') {
  await page.waitForFunction(
    ({ selector, title }) => document.querySelector(`${selector} .event-card:last-child h3`)?.textContent?.trim() === title,
    { selector: deck, title: expected }
  )
}

async function assertNoNotifications(page, label) {
  await page.waitForTimeout(80)
  assert(await page.locator('#toast-region').count() === 0, `${label}: toast region still exists`)
  assert(await page.locator('.toast').count() === 0, `${label}: a bottom-right notification appeared`)
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
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text())
  })

  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await assertDeckVisible(page, 'desktop')
  await assertNoNotifications(page, 'initial load')
  await waitForTitle(page, 'Neon Garden')

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
  await assertNoNotifications(page, 'heart swipe')

  await page.locator('[data-swipe="left"]').click()
  await waitForTitle(page, 'Rooftop Cinema Club')
  await assertNoNotifications(page, 'skip swipe')

  await page.locator('.round-action--share').click()
  await assertNoNotifications(page, 'share')

  await page.locator('.mini-like').first().click()
  assert(await page.locator('.mini-like').first().evaluate((button) => button.classList.contains('is-liked')), 'marketing like interaction failed')
  await assertNoNotifications(page, 'social heart')

  for (const type of ['organizer', 'safety']) {
    await page.locator(`[data-open-modal="${type}"]`).first().click()
    await page.waitForSelector('#modal-backdrop.is-open')
    await page.locator('[data-close-modal]').click()
    await page.waitForSelector('#modal-backdrop:not(.is-open)')
  }

  await page.evaluate(() => window.openApp())
  await page.waitForSelector('#app-demo.is-open')
  await page.waitForFunction(() => document.querySelectorAll('#demo-deck .event-card').length === 3)
  await page.locator('#app-demo [data-demo-swipe="right"]').click()
  await assertNoNotifications(page, 'demo heart')
  await page.locator('[data-close-app]').click()

  for (const viewport of [
    { width: 1024, height: 768, label: 'laptop' },
    { width: 768, height: 1024, label: 'tablet' },
    { width: 390, height: 844, label: 'mobile' },
    { width: 360, height: 640, label: 'small mobile' }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await assertDeckVisible(page, viewport.label)
    await assertNoNotifications(page, viewport.label)
  }

  const privacySource = await readFile(join(root, 'app/privacy/page.js'), 'utf8')
  const termsSource = await readFile(join(root, 'app/terms/page.js'), 'utf8')
  for (const marker of ['Information we collect', 'Location and social privacy', 'Your choices and rights', 'Back to home']) {
    assert(privacySource.includes(marker) || (await readFile(join(root, 'components/legal-page.js'), 'utf8')).includes(marker), `privacy page is missing ${marker}`)
  }
  for (const marker of ['Acceptable use', 'Tickets, payments, refunds, and payouts', 'Governing law and disputes']) {
    assert(termsSource.includes(marker), `terms page is missing ${marker}`)
  }

  assert(pageErrors.length === 0, `browser errors detected:\n${pageErrors.join('\n')}`)
  console.log('Landing, legal links, responsive cards, and notification removal tests passed.')
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
