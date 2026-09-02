import { chromium } from 'playwright'

const landingUrl = process.env.LANDING_URL || 'https://puddle.you/'
const attempts = Number(process.env.LANDING_TEST_ATTEMPTS || 3)
const delayMs = Number(process.env.LANDING_TEST_DELAY_MS || 10000)
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const browser = await chromium.launch({ headless: true })
let lastError

async function assertResponsiveFlow(page, width, height, mode) {
  await page.setViewportSize({ width, height })
  const separator = landingUrl.includes('?') ? '&' : '?'
  await page.goto(`${landingUrl}${separator}responsive=${mode}-${width}x${height}-${Date.now()}`, { waitUntil: 'networkidle', timeout: 30000 })
  const stageSelector = `.landing-stage--${mode}`
  const otherStage = mode === 'desktop' ? '.landing-stage--mobile' : '.landing-stage--desktop'
  await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.ready === 'true', stageSelector)
  assert(await page.locator(stageSelector).isVisible(), `${mode} stage is hidden at ${width}x${height}`)
  assert(!(await page.locator(otherStage).isVisible()), `wrong stage is visible at ${width}x${height}`)

  const metrics = await page.locator(stageSelector).evaluate((stage) => {
    const canvas = stage.querySelector('.landing-canvas')
    const leftCell = document.querySelector('.landing-sticky-left')
    const stickyCanvas = document.querySelector('.landing-sticky-left__canvas')
    const stageRect = stage.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    const leftRect = leftCell?.getBoundingClientRect() || null
    const stickyRect = stickyCanvas?.getBoundingClientRect() || null
    return {
      viewportWidth: document.documentElement.clientWidth,
      stageWidth: stageRect.width,
      canvasWidth: canvasRect.width,
      canvasHeight: canvasRect.height,
      left: stageRect.left,
      right: document.documentElement.clientWidth - stageRect.right,
      scrollWidth: document.documentElement.scrollWidth,
      stageDisplay: getComputedStyle(stage).display,
      canvasTransform: getComputedStyle(canvas).transform,
      canvasPosition: getComputedStyle(canvas).position,
      leftCell: leftRect ? {
        left: leftRect.left,
        width: leftRect.width,
        display: getComputedStyle(leftCell).display,
        position: getComputedStyle(leftCell).position
      } : null,
      sticky: stickyRect ? {
        left: stickyRect.left,
        width: stickyRect.width,
        display: getComputedStyle(stickyCanvas).display,
        position: getComputedStyle(stickyCanvas).position
      } : null
    }
  })

  const targetWidth = Math.min(width, mode === 'desktop' ? 1440 : 704)
  assert(Math.abs(metrics.stageWidth - targetWidth) < 1.1, `${mode} stage width ${metrics.stageWidth} does not match ${targetWidth}`)
  assert(Math.abs(metrics.left - metrics.right) < 1.1, `${mode} stage is not centered at ${width}x${height}`)
  assert(metrics.scrollWidth <= metrics.viewportWidth, `${mode} page horizontally overflows at ${width}x${height}`)
  assert(metrics.canvasTransform === 'none', `${mode} canvas still uses whole-page transform scaling`)
  assert(metrics.canvasPosition !== 'absolute', `${mode} canvas is still absolutely positioned`)
  assert(metrics.canvasHeight > height, `${mode} canvas is not growing with content`)

  if (mode === 'desktop') {
    assert(metrics.stageDisplay === 'grid', 'production desktop landing is not CSS Grid')
    assert(metrics.leftCell?.display !== 'none', 'production left grid cell is hidden')
    assert(metrics.leftCell?.position === 'relative', `production left grid cell uses ${metrics.leftCell?.position} instead of relative flow`)
    assert(metrics.sticky?.position === 'sticky', `production sign-in canvas uses ${metrics.sticky?.position} instead of sticky`)
    assert(Math.abs(metrics.leftCell.left - metrics.left) < 1.1, 'production left grid cell is not aligned to the Figma stage')
    assert(Math.abs(metrics.sticky.left - metrics.leftCell.left) < 1.1, 'production sticky canvas is not aligned to its grid cell')
    assert(Math.abs(metrics.canvasWidth + metrics.leftCell.width - metrics.stageWidth) < 2, 'production desktop columns do not fill the stage')
  } else {
    assert(metrics.stageDisplay === 'block', 'production mobile landing is not single-column')
    assert(!(await page.locator('.landing-sticky-left').isVisible()), 'desktop left pane leaked into production mobile')
  }
}

async function runLiveChecks() {
  const page = await browser.newPage({ viewport: { width: 1281, height: 900 } })
  try {
    const separator = landingUrl.includes('?') ? '&' : '?'
    await page.goto(`${landingUrl}${separator}figma-live=${Date.now()}`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.evaluate(() => document.fonts?.ready)
    await page.waitForFunction(() => document.querySelector('.landing-stage--desktop')?.dataset.ready === 'true')

    assert(await page.locator('[data-figma-node="352:484"]').isVisible(), 'desktop Figma composition is not live')
    assert(!(await page.locator('[data-figma-node="351:156"]').isVisible()), 'mobile composition is visible on desktop')
    assert(await page.locator('img[src="/figma/landing-desktop.png"]').count() === 0, 'production renders a desktop screenshot instead of real DOM')
    assert(await page.locator('.landing-sticky-left').isVisible(), 'production desktop sign-in column is missing')
    assert(await page.locator('.landing-sticky-left .login-panel input').count() === 2, 'production login is not real form markup')
    assert(await page.locator('.hero-phone-composite--desktop').isVisible(), 'desktop Figma hero phone is hidden')
    assert(await page.locator('.feature-card--d-swipe .interactive-pill').isVisible(), 'desktop Swipe Interactive pill is missing')
    assert(await page.locator('.feature-card--d-save .interactive-pill').isVisible(), 'desktop Save Interactive pill is missing')
    assert(await page.locator('.feature-card--d-feed .interactive-pill').isVisible(), 'desktop Feed Interactive pill is missing')
    assert(await page.locator('.feature-card--d-profile').count() === 0, 'desktop Profile card should not exist for Figma 352:484')
    assert(await page.locator('.trust-heading--desktop img').getAttribute('src') === '/figma/assets/lock.svg', 'production Lock is not the Figma SVG')
    assert(await page.locator('.safety-panel--desktop .safety-heart').getAttribute('src') === '/figma/assets/heart.svg', 'production Heart is not the Figma SVG')
    assert(await page.locator('.safety-panel--desktop h2').textContent() === 'Over 30 million locations worldwide', 'production safety copy is stale')
    assert(await page.locator('.safety-panel--desktop .safety-post').count() === 4, 'production safety city cards are incomplete')

    const flow = await page.evaluate(() => {
      const selectors = ['.hero--desktop','.discovery--desktop','.feature-card--d-swipe','.feature-card--d-save','.feature-card--d-feed','.trust-heading--desktop','.safety-panel--desktop','.final-cta--desktop']
      return selectors.map((selector) => {
        const node = document.querySelector(selector)
        const rect = node.getBoundingClientRect()
        return { selector, position: getComputedStyle(node).position, top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY }
      })
    })
    let previousBottom = -Infinity
    for (const item of flow) {
      assert(item.position !== 'absolute' && item.position !== 'fixed', `${item.selector} is still page-positioned with ${item.position}`)
      assert(item.top >= previousBottom - 2, `${item.selector} is out of normal page order`)
      previousBottom = item.bottom
    }

    const stickyBefore = await page.locator('.landing-sticky-left__canvas').boundingBox()
    const swipeBefore = await page.locator('.feature-card--d-swipe').boundingBox()
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 1000) })
    await page.waitForFunction(() => Math.abs(window.scrollY - 1000) < 3)
    const stickyAfter = await page.locator('.landing-sticky-left__canvas').boundingBox()
    const swipeAfter = await page.locator('.feature-card--d-swipe').boundingBox()
    assert(stickyBefore && stickyAfter && Math.abs(stickyAfter.y - stickyBefore.y) < 2, 'production sign-in canvas moves while scrolling')
    assert(swipeBefore && swipeAfter && swipeAfter.y < swipeBefore.y - 900, 'production right column does not scroll independently')

    const footer = page.locator('#footer-d')
    await footer.scrollIntoViewIfNeeded()
    const overlap = await page.evaluate(() => {
      const sticky = document.querySelector('.landing-sticky-left__canvas')?.getBoundingClientRect()
      const footer = document.querySelector('#footer-d')?.getBoundingClientRect()
      if (!sticky || !footer) return Infinity
      return Math.max(0, Math.min(sticky.bottom, footer.bottom) - Math.max(sticky.top, footer.top))
    })
    assert(overlap === 0, `production sticky sign-in canvas overlaps footer by ${overlap}px`)

    const phone = await page.locator('.feature-card--d-swipe .feature-phone-demo').boundingBox()
    assert(phone && phone.width > 250 && phone.height > 500, 'production interactive Swipe phone has no usable viewport')
    for (const path of ['/signup', '/privacy', '/terms']) assert(await page.locator(`a[href="${path}"]`).count() > 0, `${path} link is missing from landing page`)

    for (const [width, height] of [[1920,1080],[1440,900],[1366,768],[1024,768],[800,600],[761,900]]) await assertResponsiveFlow(page, width, height, 'desktop')

    await page.setViewportSize({ width: 704, height: 900 })
    await page.goto(`${landingUrl}${separator}figma-mobile=${Date.now()}`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.evaluate(() => document.fonts?.ready)
    await page.waitForFunction(() => document.querySelector('.landing-stage--mobile')?.dataset.ready === 'true')
    assert(await page.locator('[data-figma-node="351:156"]').isVisible(), 'mobile Figma composition is not live')
    assert(!(await page.locator('.landing-sticky-left').isVisible()), 'desktop sign-in column leaked into mobile')
    assert(await page.locator('.feature-card--m-swipe').isVisible(), 'production mobile Swipe card is missing')
    assert(await page.locator('.feature-card--m-profile').count() === 0, 'production mobile Profile card should not exist in the updated Figma frame')
    assert(await page.locator('.mobile-login-button').getAttribute('href') === '/signin', 'production mobile Login action is missing')
    assert(await page.locator('.feature-card--m-swipe .interactive-pill').isVisible(), 'production mobile Interactive pill is missing')

    for (const [width, height] of [[760,900],[704,900],[430,932],[390,844],[320,700]]) await assertResponsiveFlow(page, width, height, 'mobile')
    console.log('Live Figma frontend passed: semantic row-constrained sticky split, normal-flow sections, interactive phones, mobile composition, footer handoff, and no whole-canvas scaling.')
  } finally { await page.close() }
}

try {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { await runLiveChecks(); lastError = null; break }
    catch (error) { lastError = error; console.log(`Live check ${attempt}/${attempts} failed: ${error.message}`); if (attempt < attempts) await sleep(delayMs) }
  }
  if (lastError) throw lastError
} finally { await browser.close() }
