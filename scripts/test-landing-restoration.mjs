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

async function topCardTitle(page, deck = '#hero-deck') {
  return page.locator(`${deck} .event-card:last-child h3`).textContent()
}

async function waitForTitle(page, expected, deck = '#hero-deck') {
  await page.waitForFunction(
    ({ selector, title }) => document.querySelector(`${selector} .event-card:last-child h3`)?.textContent?.trim() === title,
    { selector: deck, title: expected }
  )
}

async function assertDeckVisible(page, label) {
  await page.waitForFunction(() => document.querySelectorAll('#hero-deck .event-card').length === 3)
  const count = await page.locator('#hero-deck .event-card').count()
  assert(count === 3, `${label}: expected three event cards, found ${count}`)
  const box = await page.locator('#hero-deck .event-card:last-child').boundingBox()
  assert(box && box.width > 200 && box.height > 300, `${label}: top event card is not visibly rendered`)
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
  assert((await topCardTitle(page))?.trim() === 'Neon Garden', 'desktop: Neon Garden is not the initial top card')

  const authLinks = await page.locator('.header-actions a').evaluateAll((links) => links.map((link) => ({ label: link.textContent.trim(), href: new URL(link.href).pathname })))
  assert(authLinks.some((link) => link.label.startsWith('Sign In') && link.href === '/signin'), 'header Sign In link is missing')
  assert(authLinks.some((link) => link.label.startsWith('Register') && link.href === '/signup'), 'header Register link is missing')

  await page.locator('[data-swipe="right"]').click()
  await waitForTitle(page, 'Clay & Cabernet')
  await page.locator('[data-swipe="undo"]').click()
  await waitForTitle(page, 'Neon Garden')

  await page.locator('#hero-deck .event-card:last-child').focus()
  await page.keyboard.press('ArrowRight')
  await waitForTitle(page, 'Clay & Cabernet')
  await page.locator('[data-swipe="undo"]').click()
  await waitForTitle(page, 'Neon Garden')

  const dragCard = page.locator('#hero-deck .event-card:last-child')
  const dragBox = await dragCard.boundingBox()
  assert(dragBox, 'drag test: top card has no bounding box')
  await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(dragBox.x + dragBox.width / 2 + 150, dragBox.y + dragBox.height / 2, { steps: 8 })
  await page.mouse.up()
  await waitForTitle(page, 'Clay & Cabernet')
  await page.locator('[data-swipe="undo"]').click()
  await waitForTitle(page, 'Neon Garden')

  await page.locator('.round-action--share').click()
  await page.waitForSelector('.toast', { state: 'visible' })

  await page.locator('.mini-like').first().click()
  assert(await page.locator('.mini-like').first().evaluate((button) => button.classList.contains('is-liked') && button.textContent.trim() === '✓'), 'marketing like interaction failed')

  await page.locator('#marketing-chat-form input').fill('Landing restoration test')
  await page.locator('#marketing-chat-form').evaluate((form) => form.requestSubmit())
  await page.waitForFunction(() => document.querySelector('#marketing-chat')?.textContent?.includes('Landing restoration test'))

  await page.locator('#location-toggle').click()
  assert(await page.locator('#location-map').evaluate((map) => map.classList.contains('is-sharing')), 'location sharing interaction failed')

  for (const type of ['organizer', 'safety', 'privacy', 'terms']) {
    await page.locator(`[data-open-modal="${type}"]`).first().click()
    await page.waitForSelector('#modal-backdrop.is-open')
    assert((await page.locator('#modal-title').textContent())?.trim().length > 0, `${type} modal has no title`)
    await page.locator('[data-close-modal]').click()
    await page.waitForSelector('#modal-backdrop:not(.is-open)')
  }

  await page.locator('.hero-actions [data-open-app]').click()
  await page.waitForSelector('#app-demo.is-open')
  await page.waitForFunction(() => document.querySelectorAll('#demo-deck .event-card').length === 3)

  const views = {
    discover: 'Find your next plan.',
    explore: 'Explore your city.',
    plans: 'Your calendar looks good.',
    social: 'Meet your crowd.',
    messages: 'Keep the plan moving.',
    tickets: 'You’re in.'
  }
  for (const [view, title] of Object.entries(views)) {
    await page.locator(`.app-sidebar [data-app-view="${view}"]`).click()
    await page.waitForFunction((expected) => document.querySelector('#app-title')?.textContent?.trim() === expected, title)
  }

  await page.locator('.app-sidebar [data-app-view="messages"]').click()
  await page.locator('#demo-message-form input').fill('Demo message restored')
  await page.locator('#demo-message-form').evaluate((form) => form.requestSubmit())
  await page.waitForFunction(() => document.querySelector('#demo-message-thread')?.textContent?.includes('Demo message restored'))

  await page.locator('.app-sidebar [data-app-view="tickets"]').click()
  await page.locator('[data-ticket-code]').first().click()
  assert((await page.locator('[data-ticket-code]').first().textContent())?.includes('QR ready'), 'ticket QR interaction failed')

  await page.locator('[data-close-app]').click()
  await page.waitForSelector('#app-demo:not(.is-open)')

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

  assert(pageErrors.length === 0, `browser errors detected:\n${pageErrors.join('\n')}`)

  const demoSource = await readFile(join(publicRoot, 'landing-demo.js'), 'utf8')
  for (const marker of [
    'Neon Garden', 'Clay & Cabernet', 'Rooftop Cinema Club', 'Late Night Jazz Club',
    'Sunset Run & Gelato', 'Indie Makers After Dark', 'attachDrag', 'completeSwipe',
    'undo', 'renderAppView', 'marketing-chat-form', 'location-toggle'
  ]) {
    assert(demoSource.includes(marker), `landing demo source is missing ${marker}`)
  }

  const nextConfig = await readFile(join(root, 'next.config.mjs'), 'utf8')
  assert(nextConfig.includes("source: '/', destination: '/landing.html'"), 'homepage no longer routes to the restored landing page')

  console.log('Landing restoration browser tests passed on desktop, laptop, tablet, and mobile.')
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
