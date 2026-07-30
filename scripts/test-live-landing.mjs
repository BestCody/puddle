import { chromium } from 'playwright'

const landingUrl = process.env.LANDING_URL || 'https://puddle.you/'
const attempts = Number(process.env.LANDING_TEST_ATTEMPTS || 48)
const delayMs = Number(process.env.LANDING_TEST_DELAY_MS || 15000)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const browser = await chromium.launch({ headless: true })
let lastError

async function waitForTitle(page, title, deck = '#hero-deck') {
  await page.waitForFunction(
    ({ selector, expected }) => document.querySelector(`${selector} .event-card:last-child h3`)?.textContent?.trim() === expected,
    { selector: deck, expected: title },
    { timeout: 8000 }
  )
}

async function runLiveChecks() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })

  try {
    const separator = landingUrl.includes('?') ? '&' : '?'
    await page.goto(`${landingUrl}${separator}landing-e2e=${Date.now()}`, { waitUntil: 'networkidle', timeout: 30000 })

    const appSource = await page.evaluate(async () => {
      const response = await fetch(`/app.js?v=1&landing-e2e=${Date.now()}`, { cache: 'no-store' })
      return response.text()
    })
    assert(appSource.includes('pendingDomReadyListeners'), 'production is still serving the old landing loader')

    await page.waitForFunction(() => document.querySelectorAll('#hero-deck .event-card').length === 3, null, { timeout: 10000 })
    const initialTitle = await page.locator('#hero-deck .event-card:last-child h3').textContent()
    assert(initialTitle?.trim() === 'Neon Garden', `unexpected initial event: ${initialTitle}`)
    assert(!(await page.locator('html').getAttribute('data-landing-error')), 'landing page reported an initialization error')

    const topBox = await page.locator('#hero-deck .event-card:last-child').boundingBox()
    assert(topBox && topBox.width > 200 && topBox.height > 300, 'phone event card is not visibly displayed')

    const links = await page.locator('.header-actions a').evaluateAll((nodes) => nodes.map((node) => ({
      label: node.textContent.trim(),
      path: new URL(node.href).pathname
    })))
    assert(links.some((link) => link.label.startsWith('Sign In') && link.path === '/signin'), 'Sign In is missing from the live header')
    assert(links.some((link) => link.label.startsWith('Register') && link.path === '/signup'), 'Register is missing from the live header')

    await page.locator('[data-swipe="right"]').click()
    await waitForTitle(page, 'Clay & Cabernet')
    await page.locator('[data-swipe="undo"]').click()
    await waitForTitle(page, 'Neon Garden')

    await page.locator('#hero-deck .event-card:last-child').focus()
    await page.keyboard.press('ArrowRight')
    await waitForTitle(page, 'Clay & Cabernet')
    await page.locator('[data-swipe="undo"]').click()
    await waitForTitle(page, 'Neon Garden')

    const dragBox = await page.locator('#hero-deck .event-card:last-child').boundingBox()
    assert(dragBox, 'live drag test could not locate the top event card')
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
    assert(await page.locator('.mini-like').first().evaluate((button) => button.classList.contains('is-liked')), 'live like interaction failed')

    await page.locator('#marketing-chat-form input').fill('Live landing test')
    await page.locator('#marketing-chat-form').evaluate((form) => form.requestSubmit())
    await page.waitForFunction(() => document.querySelector('#marketing-chat')?.textContent?.includes('Live landing test'))

    await page.locator('#location-toggle').click()
    assert(await page.locator('#location-map').evaluate((map) => map.classList.contains('is-sharing')), 'live location sharing interaction failed')

    for (const type of ['organizer', 'safety', 'privacy', 'terms']) {
      await page.locator(`[data-open-modal="${type}"]`).first().click()
      await page.waitForSelector('#modal-backdrop.is-open')
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

    await page.locator('.app-sidebar [data-app-view="tickets"]').click()
    await page.locator('[data-ticket-code]').first().click()
    assert((await page.locator('[data-ticket-code]').first().textContent())?.includes('QR ready'), 'live ticket interaction failed')
    await page.locator('[data-close-app]').click()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForFunction(() => document.querySelectorAll('#hero-deck .event-card').length === 3)
    const mobileBox = await page.locator('#hero-deck .event-card:last-child').boundingBox()
    assert(mobileBox && mobileBox.width > 200 && mobileBox.height > 300, 'event cards are not visible on mobile')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    assert(overflow <= 2, `live mobile page overflows horizontally by ${overflow}px`)

    assert(browserErrors.length === 0, `live browser errors:\n${browserErrors.join('\n')}`)
  } finally {
    await page.close()
  }
}

try {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await runLiveChecks()
      console.log(`Live landing restoration passed at ${landingUrl}`)
      lastError = null
      break
    } catch (error) {
      lastError = error
      console.log(`Live landing attempt ${attempt}/${attempts} failed: ${error.message}`)
      if (attempt < attempts) await sleep(delayMs)
    }
  }

  if (lastError) throw lastError
} finally {
  await browser.close()
}
