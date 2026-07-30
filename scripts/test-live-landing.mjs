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
  assert(await page.locator('#toast-region').count() === 0, `${label}: toast region still exists`)
  assert(await page.locator('.toast').count() === 0, `${label}: bottom-right notification appeared`)
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

    await waitUntil(async () => (await page.locator('#hero-deck .event-card').count()) === 3, 'landing deck did not load')
    await waitForText(page, '#hero-deck .event-card:last-child h3', 'Neon Garden')
    await assertNoNotifications(page, 'initial load')

    const card = page.locator('#hero-deck .event-card:last-child')
    const cardBox = await card.boundingBox()
    const footerBox = await card.locator('.event-card__footer').boundingBox()
    assert(cardBox && cardBox.width > 200 && cardBox.height > 300, 'phone event card is not visible')
    assert(footerBox && footerBox.y + footerBox.height <= cardBox.y + cardBox.height + 2, 'phone event card footer is clipped')

    const getStarted = page.locator('.hero-actions a')
    assert(new URL(await getStarted.getAttribute('href'), landingUrl).pathname === '/signup', 'Get Started does not link to registration')

    const legalLinks = await page.locator('.site-footer a').evaluateAll((items) => items.map((item) => ({ label: item.textContent.trim(), path: new URL(item.href).pathname })))
    assert(legalLinks.some((link) => link.label === 'Privacy' && link.path === '/privacy'), 'Privacy link is missing')
    assert(legalLinks.some((link) => link.label === 'Terms' && link.path === '/terms'), 'Terms link is missing')

    await page.locator('[data-swipe="right"]').click()
    await waitForText(page, '#hero-deck .event-card:last-child h3', 'Clay & Cabernet')
    await assertNoNotifications(page, 'heart swipe')

    await page.locator('[data-swipe="left"]').click()
    await waitForText(page, '#hero-deck .event-card:last-child h3', 'Rooftop Cinema Club')
    await assertNoNotifications(page, 'skip swipe')

    await page.locator('.round-action--share').click()
    await assertNoNotifications(page, 'share')

    await page.locator('.mini-like').first().click()
    assert((await page.locator('.mini-like').first().getAttribute('class'))?.includes('is-liked'), 'social like interaction failed')
    await assertNoNotifications(page, 'social like')

    for (const type of ['organizer', 'safety']) {
      await page.locator(`[data-open-modal="${type}"]`).first().click()
      await page.locator('#modal-backdrop.is-open').waitFor({ state: 'visible' })
      await page.locator('[data-close-modal]').click()
      await waitUntil(async () => !(await page.locator('#modal-backdrop').getAttribute('class'))?.includes('is-open'), `${type} modal did not close`)
    }

    await page.evaluate(() => window.openApp())
    await page.locator('#app-demo.is-open').waitFor({ state: 'visible' })
    await waitUntil(async () => (await page.locator('#demo-deck .event-card').count()) === 3, 'demo deck did not load')
    await page.locator('#app-demo [data-demo-swipe="right"]').click()
    await assertNoNotifications(page, 'demo swipe')
    await page.locator('[data-close-app]').click()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload({ waitUntil: 'networkidle' })
    await waitUntil(async () => (await page.locator('#hero-deck .event-card').count()) === 3, 'mobile deck did not load')
    const mobileCard = page.locator('#hero-deck .event-card:last-child')
    const mobileBox = await mobileCard.boundingBox()
    const mobileFooter = await mobileCard.locator('.event-card__footer').boundingBox()
    assert(mobileBox && mobileBox.width > 200 && mobileBox.height > 300, 'event card is not visible on mobile')
    assert(mobileFooter && mobileFooter.y + mobileFooter.height <= mobileBox.y + mobileBox.height + 2, 'event card footer is clipped on mobile')
    assert(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 2, 'mobile landing page overflows horizontally')
    await assertNoNotifications(page, 'mobile')

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
      console.log(`Live landing and legal-page checks passed at ${landingUrl}`)
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
