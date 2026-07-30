import { chromium } from 'playwright'

const landingUrl = process.env.LANDING_URL || 'https://puddle.you/'
const attempts = Number(process.env.LANDING_TEST_ATTEMPTS || 12)
const delayMs = Number(process.env.LANDING_TEST_DELAY_MS || 10000)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const browser = await chromium.launch({ headless: true })
let lastError

async function waitUntil(check, message, timeout = 10000, interval = 100) {
  const deadline = Date.now() + timeout
  let lastValue
  while (Date.now() < deadline) {
    lastValue = await check()
    if (lastValue) return lastValue
    await sleep(interval)
  }
  throw new Error(`${message}${lastValue === undefined ? '' : `; last value: ${String(lastValue)}`}`)
}

async function waitForCount(page, selector, count, timeout = 10000) {
  return waitUntil(
    async () => (await page.locator(selector).count()) === count,
    `expected ${count} elements for ${selector}`,
    timeout
  )
}

async function waitForText(page, selector, expected, timeout = 10000) {
  return waitUntil(
    async () => (await page.locator(selector).textContent())?.trim() === expected,
    `expected ${selector} to contain ${expected}`,
    timeout
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

    const appUrl = new URL(`/app.js?v=1&landing-e2e=${Date.now()}`, landingUrl)
    const appResponse = await fetch(appUrl, { cache: 'no-store' })
    assert(appResponse.ok, `could not fetch live app.js: ${appResponse.status}`)
    const appSource = await appResponse.text()
    assert(appSource.includes('pendingDomReadyListeners'), 'production is still serving the old landing loader')

    await waitForCount(page, '#hero-deck .event-card', 3)
    await waitForText(page, '#hero-deck .event-card:last-child h3', 'Neon Garden')
    assert(!(await page.locator('html').getAttribute('data-landing-error')), 'landing page reported an initialization error')

    const topBox = await page.locator('#hero-deck .event-card:last-child').boundingBox()
    assert(topBox && topBox.width > 200 && topBox.height > 300, 'phone event card is not visibly displayed')

    const headerLinks = page.locator('.header-actions a')
    const headerLinkCount = await headerLinks.count()
    const links = []
    for (let index = 0; index < headerLinkCount; index += 1) {
      const link = headerLinks.nth(index)
      links.push({
        label: (await link.textContent())?.trim() || '',
        path: new URL(await link.getAttribute('href'), landingUrl).pathname
      })
    }
    assert(links.some((link) => link.label.startsWith('Sign In') && link.path === '/signin'), 'Sign In is missing from the live header')
    assert(links.some((link) => link.label.startsWith('Register') && link.path === '/signup'), 'Register is missing from the live header')

    await page.locator('[data-swipe="right"]').click()
    await waitForText(page, '#hero-deck .event-card:last-child h3', 'Clay & Cabernet')
    await page.locator('[data-swipe="undo"]').click()
    await waitForText(page, '#hero-deck .event-card:last-child h3', 'Neon Garden')

    await page.locator('#hero-deck .event-card:last-child').focus()
    await page.keyboard.press('ArrowRight')
    await waitForText(page, '#hero-deck .event-card:last-child h3', 'Clay & Cabernet')
    await page.locator('[data-swipe="undo"]').click()
    await waitForText(page, '#hero-deck .event-card:last-child h3', 'Neon Garden')

    const dragBox = await page.locator('#hero-deck .event-card:last-child').boundingBox()
    assert(dragBox, 'live drag test could not locate the top event card')
    await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(dragBox.x + dragBox.width / 2 + 150, dragBox.y + dragBox.height / 2, { steps: 8 })
    await page.mouse.up()
    await waitForText(page, '#hero-deck .event-card:last-child h3', 'Clay & Cabernet')
    await page.locator('[data-swipe="undo"]').click()
    await waitForText(page, '#hero-deck .event-card:last-child h3', 'Neon Garden')

    await page.locator('.round-action--share').click()
    await page.locator('.toast').waitFor({ state: 'visible' })

    await page.locator('.mini-like').first().click()
    assert((await page.locator('.mini-like').first().getAttribute('class'))?.includes('is-liked'), 'live like interaction failed')

    await page.locator('#marketing-chat-form input').fill('Live landing test')
    await page.locator('#marketing-chat-form input').press('Enter')
    await waitUntil(
      async () => (await page.locator('#marketing-chat').textContent())?.includes('Live landing test'),
      'live marketing chat message did not appear'
    )

    await page.locator('#location-toggle').click()
    assert((await page.locator('#location-map').getAttribute('class'))?.includes('is-sharing'), 'live location sharing interaction failed')

    for (const type of ['organizer', 'safety', 'privacy', 'terms']) {
      await page.locator(`[data-open-modal="${type}"]`).first().click()
      await page.locator('#modal-backdrop.is-open').waitFor({ state: 'visible' })
      await page.locator('[data-close-modal]').click()
      await waitUntil(
        async () => !(await page.locator('#modal-backdrop').getAttribute('class'))?.includes('is-open'),
        `${type} modal did not close`
      )
    }

    await page.locator('.hero-actions [data-open-app]').click()
    await page.locator('#app-demo.is-open').waitFor({ state: 'visible' })
    await waitForCount(page, '#demo-deck .event-card', 3)

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
      await waitForText(page, '#app-title', title)
    }

    await page.locator('.app-sidebar [data-app-view="messages"]').click()
    await page.locator('#demo-message-form input').fill('Live demo message')
    await page.locator('#demo-message-form input').press('Enter')
    await waitUntil(
      async () => (await page.locator('#demo-message-thread').textContent())?.includes('Live demo message'),
      'live demo message did not appear'
    )

    await page.locator('.app-sidebar [data-app-view="tickets"]').click()
    await page.locator('[data-ticket-code]').first().click()
    assert((await page.locator('[data-ticket-code]').first().textContent())?.includes('QR ready'), 'live ticket interaction failed')
    await page.locator('[data-close-app]').click()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload({ waitUntil: 'networkidle' })
    await waitForCount(page, '#hero-deck .event-card', 3)
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
