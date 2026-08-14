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
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await sleep(interval)
  }
  throw new Error(message)
}

async function waitForText(page, selector, expected) {
  return waitUntil(
    async () => (await page.locator(selector).textContent())?.trim() === expected,
    `expected ${selector} to contain ${expected}`
  )
}

async function assertNoNotifications(page, label) {
  await page.waitForTimeout(100)
  assert(await page.locator('#toast-region').count() === 0, `${label}: retired toast region still exists`)
  assert(await page.locator('.toast').count() === 0, `${label}: unexpected notification appeared`)
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

    await waitUntil(async () => (await page.locator('#hero-deck .event-card').count()) === 3, 'Figma landing deck did not load')
    await waitForText(page, '#hero-deck .event-card:last-child h3', 'Moonlight Café')
    await assertNoNotifications(page, 'initial load')

    assert((await page.locator('.hero-copy h1').textContent())?.includes('Discover places.'), 'Figma hero headline is missing')
    assert((await page.locator('.hero-copy h1').textContent())?.includes('See who’s there.'), 'Figma hero social promise is missing')
    assert(await page.locator('.feature-card').count() === 4, 'four Figma feature panels are not live')

    const card = page.locator('#hero-deck .event-card:last-child')
    const cardBox = await card.boundingBox()
    assert(cardBox && cardBox.width > 200 && cardBox.height > 300, 'phone location card is not visible')

    for (const path of ['/signin', '/signup', '/privacy', '/terms']) {
      assert(await page.locator(`a[href="${path}"]`).count() > 0, `${path} native route link is missing`)
    }

    const legalLinks = await page.locator('.site-footer a').evaluateAll((items) => items.map((item) => ({ label: item.textContent.trim(), path: new URL(item.href).pathname })))
    assert(legalLinks.some((link) => link.label === 'Privacy' && link.path === '/privacy'), 'Privacy link is missing')
    assert(legalLinks.some((link) => link.label === 'Terms' && link.path === '/terms'), 'Terms link is missing')

    await page.locator('[data-swipe="right"]').first().click()
    await waitForText(page, '#hero-deck .event-card:last-child h3', 'Clay & Cabernet')
    await assertNoNotifications(page, 'save swipe')

    await page.locator('[data-swipe="left"]').click()
    await waitForText(page, '#hero-deck .event-card:last-child h3', 'Rooftop Cinema Club')
    await page.locator('[data-swipe="undo"]').click()
    await waitForText(page, '#hero-deck .event-card:last-child h3', 'Clay & Cabernet')

    const safetyButton = page.locator('[data-open-modal="safety"]').first()
    assert(await safetyButton.count() === 1, 'safety model button is missing')
    await safetyButton.click()
    await page.locator('#modal-backdrop.is-open').waitFor({ state: 'visible' })
    await waitForText(page, '#modal-title', 'Shared places first. Privacy controls always.')
    await page.locator('[data-close-modal]').click()
    await waitUntil(async () => !(await page.locator('#modal-backdrop').getAttribute('class'))?.includes('is-open'), 'safety modal did not close')

    await page.locator('.menu-button').click()
    assert((await page.locator('#site-header').getAttribute('class'))?.includes('menu-open'), 'header menu did not open')
    assert(await page.locator('.header-actions a[href="/signin"]').count() === 1, 'header Sign in link is missing')
    assert(await page.locator('.header-actions a[href="/signup"]').count() === 1, 'header Create account link is missing')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload({ waitUntil: 'networkidle' })
    await waitUntil(async () => (await page.locator('#hero-deck .event-card').count()) === 3, 'mobile Figma deck did not load')
    const mobileCard = page.locator('#hero-deck .event-card:last-child')
    const mobileBox = await mobileCard.boundingBox()
    assert(mobileBox && mobileBox.width > 200 && mobileBox.height > 300, 'location card is not visible on mobile')
    assert(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 2, 'mobile landing page overflows horizontally')
    await assertNoNotifications(page, 'mobile')

    for (const auth of [
      { path: '/signin', title: 'Discover places. See who’s there.' },
      { path: '/signup', title: 'Make plans that leave the chat.' }
    ]) {
      await page.goto(new URL(auth.path, landingUrl).href, { waitUntil: 'networkidle', timeout: 30000 })
      await waitForText(page, 'h1', auth.title)
    }

    for (const policy of [
      { path: '/privacy', title: 'Privacy Policy', marker: 'Information we collect' },
      { path: '/terms', title: 'Terms of Service', marker: 'Acceptable use' }
    ]) {
      await page.goto(new URL(policy.path, landingUrl).href, { waitUntil: 'networkidle', timeout: 30000 })
      await waitForText(page, 'h1', policy.title)
      assert((await page.locator('body').textContent())?.includes(policy.marker), `${policy.title} content is missing`)
      const homeLink = page.locator('a', { hasText: 'Back to home' }).first()
      assert(await homeLink.count() === 1, `${policy.title} has no Back to home link`)
      assert(new URL(await homeLink.getAttribute('href'), landingUrl).pathname === '/', `${policy.title} Back to home link is incorrect`)
    }

    assert(browserErrors.length === 0, `live browser errors:\n${browserErrors.join('\n')}`)
  } finally {
    await page.close()
  }
}

try {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await runLiveChecks()
      console.log(`Live official Figma landing, auth, and legal-page checks passed at ${landingUrl}`)
      lastError = null
      break
    } catch (error) {
      lastError = error
      console.log(`Live check ${attempt}/${attempts} failed: ${error.message}`)
      if (attempt < attempts) await sleep(delayMs)
    }
  }
  if (lastError) throw lastError
} finally {
  await browser.close()
}
