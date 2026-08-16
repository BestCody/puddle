import { chromium } from 'playwright'

const landingUrl = process.env.LANDING_URL || 'https://puddle.you/'
const attempts = Number(process.env.LANDING_TEST_ATTEMPTS || 3)
const delayMs = Number(process.env.LANDING_TEST_DELAY_MS || 10000)
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const near = (actual, expected, tolerance = 1.5) => Math.abs(actual - expected) <= tolerance
const browser = await chromium.launch({ headless: true })
let lastError

function targetResponsiveWidth(width, height, mode) { return mode === 'desktop' ? Math.min(width, 1281, height * 1.425) : Math.min(width, 704) }

async function assertResponsiveScale(page, width, height, mode, sourceWidth, sourceHeight) {
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
    const sticky = document.querySelector('.landing-sticky-left')
    const stageRect = stage.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    const stickyRect = sticky?.getBoundingClientRect() || null
    return { viewportWidth: document.documentElement.clientWidth, viewportHeight: window.innerHeight, stageWidth: stageRect.width, stageHeight: stageRect.height, canvasWidth: canvasRect.width, canvasHeight: canvasRect.height, left: stageRect.left, right: document.documentElement.clientWidth - stageRect.right, scrollWidth: document.documentElement.scrollWidth, sticky: stickyRect ? { left: stickyRect.left, top: stickyRect.top, width: stickyRect.width, height: stickyRect.height, display: getComputedStyle(sticky).display } : null }
  })
  const targetWidth = targetResponsiveWidth(width, height, mode)
  const expectedHeight = targetWidth * sourceHeight / sourceWidth
  assert(Math.abs(metrics.stageWidth - targetWidth) < 1.1, `${mode} stage width ${metrics.stageWidth} does not match fit target ${targetWidth}px`)
  assert(Math.abs(metrics.canvasWidth - targetWidth) < 1.1, `${mode} canvas width ${metrics.canvasWidth} does not match fit target ${targetWidth}px`)
  assert(Math.abs(metrics.stageHeight - expectedHeight) < 1.5, `${mode} stage aspect ratio changed at ${width}x${height}`)
  assert(Math.abs(metrics.canvasHeight - expectedHeight) < 1.5, `${mode} canvas aspect ratio changed at ${width}x${height}`)
  assert(Math.abs(metrics.left - metrics.right) < 1.1, `${mode} stage is not centered at ${width}x${height}`)
  assert(metrics.scrollWidth <= metrics.viewportWidth, `${mode} page horizontally overflows at ${width}x${height}`)
  if (mode === 'desktop') {
    const scale = targetWidth / 1281
    assert(metrics.sticky?.display !== 'none', 'production sticky left pane is hidden')
    assert(Math.abs(metrics.sticky.left - metrics.left) < 1.1, 'production sticky pane is not aligned to the Figma stage')
    assert(Math.abs(metrics.sticky.top) < 1.1, 'production sticky pane is not pinned to viewport top')
    assert(Math.abs(metrics.sticky.width - 615 * scale) < 1.1, 'production sticky pane width is wrong')
  }
}

async function cssBox(page, selector) {
  return page.locator(selector).evaluate((node) => {
    const style = getComputedStyle(node)
    return { left: Number.parseFloat(style.left), top: Number.parseFloat(style.top), width: Number.parseFloat(style.width), height: Number.parseFloat(style.height), display: style.display }
  })
}
function assertBox(box, expected, label) {
  for (const [key, value] of Object.entries(expected)) assert(near(box[key], value), `${label} ${key} ${box[key]} does not match current Figma ${value}`)
}

async function runLiveChecks() {
  const page = await browser.newPage({ viewport: { width: 1281, height: 900 } })
  try {
    const separator = landingUrl.includes('?') ? '&' : '?'
    await page.goto(`${landingUrl}${separator}figma-live=${Date.now()}`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.evaluate(() => document.fonts?.ready)
    await page.waitForFunction(() => document.querySelector('.landing-stage--desktop')?.dataset.ready === 'true')

    assert(await page.locator('[data-figma-node="83:76"]').isVisible(), 'desktop real-DOM Figma canvas is not live')
    assert(!(await page.locator('[data-figma-node="161:116"]').isVisible()), 'mobile canvas is visible on desktop')
    assert(await page.locator('img[src="/figma/landing-desktop.png"]').count() === 0, 'production renders the old full desktop Figma screenshot')
    assert(await page.locator('.landing-sticky-left').isVisible(), 'production pinned left pane is missing')
    assert(await page.locator('.landing-sticky-left .login-panel input').count() === 2, 'production pinned login is not real form markup')
    assert(await page.locator('.hero-phone-composite--desktop').isVisible(), 'current desktop Figma hero phone is hidden')
    assert((await cssBox(page, '.discovery--desktop .city-photo-wrap')).display === 'none', 'production still renders obsolete city artwork')
    assertBox(await cssBox(page, '.feature-card--d-swipe'), { left: 668.618, top: 1630.039, width: 535.595, height: 872.533 }, 'production Swipe card')
    assertBox(await cssBox(page, '.feature-card--d-save'), { left: 677.382, top: 2562.948, width: 535.595, height: 874.48 }, 'production Save card')
    assertBox(await cssBox(page, '.feature-card--d-feed'), { left: 679.33, top: 3494.883, width: 535.595, height: 874.48 }, 'production Feed card')
    assert(!(await page.locator('.feature-card--d-profile').isVisible()), 'production desktop Profile card should be hidden for current Figma')
    assertBox(await cssBox(page, '.trust-heading--desktop img'), { left: 889.955, top: 4452, width: 89.976, height: 89.976 }, 'production Lock')
    assertBox(await cssBox(page, '.safety-panel--desktop'), { left: 628, top: 4763.619, width: 614.473, height: 1489.927 }, 'production safety panel')
    assertBox(await cssBox(page, '.site-footer--desktop'), { left: -9.305, top: 6792, width: 1291, height: 786 }, 'production footer')

    const fidelity = await page.evaluate(() => {
      const lock = document.querySelector('.trust-heading--desktop img')
      const heart = document.querySelector('.safety-panel--desktop .safety-heart')
      return { lockBg: lock ? getComputedStyle(lock).backgroundColor : null, lockSrc: lock?.getAttribute('src') || null, heartContent: heart ? getComputedStyle(heart).content : null }
    })
    assert(fidelity.lockBg === 'rgba(0, 0, 0, 0)', `production Lock background is ${fidelity.lockBg}`)
    assert(fidelity.lockSrc === '/figma/assets/lock.svg', `production Lock is using ${fidelity.lockSrc}`)
    assert(fidelity.heartContent?.includes('heart.svg'), 'production Heart is not the transparent Figma SVG')

    const stickyBefore = await page.locator('.landing-sticky-left').boundingBox()
    const swipeBefore = await page.locator('.feature-card--d-swipe').boundingBox()
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto'
      window.scrollTo(0, 1000)
    })
    await page.waitForFunction(() => Math.abs(window.scrollY - 1000) < 2)
    const stickyAfter = await page.locator('.landing-sticky-left').boundingBox()
    const swipeAfter = await page.locator('.feature-card--d-swipe').boundingBox()
    assert(stickyBefore && stickyAfter && Math.abs(stickyAfter.y - stickyBefore.y) < 1, 'production left pane moves while scrolling')
    assert(swipeBefore && swipeAfter && swipeAfter.y < swipeBefore.y - 900, 'production right Figma column does not scroll independently')
    await page.evaluate(() => window.scrollTo(0, 0))

    const phone = await page.locator('.feature-card--d-swipe .feature-phone-demo').boundingBox()
    assert(phone && phone.width > 300 && phone.height > 700, 'production interactive Swipe phone has no usable viewport')
    for (const path of ['/signin', '/signup', '/privacy', '/terms']) assert(await page.locator(`a[href="${path}"]`).count() > 0, `${path} link is missing from landing page`)

    await assertResponsiveScale(page, 1920, 1080, 'desktop', 1281, 7578)
    await assertResponsiveScale(page, 1440, 900, 'desktop', 1281, 7578)
    await assertResponsiveScale(page, 1366, 768, 'desktop', 1281, 7578)
    await assertResponsiveScale(page, 1024, 768, 'desktop', 1281, 7578)
    await assertResponsiveScale(page, 800, 600, 'desktop', 1281, 7578)

    await page.setViewportSize({ width: 704, height: 900 })
    await page.goto(`${landingUrl}${separator}figma-mobile=${Date.now()}`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.evaluate(() => document.fonts?.ready)
    await page.waitForFunction(() => document.querySelector('.landing-stage--mobile')?.dataset.ready === 'true')
    assert(await page.locator('[data-figma-node="161:116"]').isVisible(), 'mobile real-DOM Figma canvas is not live')
    assert(!(await page.locator('.landing-sticky-left').isVisible()), 'desktop pinned pane leaked into mobile')
    assert(await page.locator('.feature-card--m-swipe').isVisible(), 'production mobile Swipe card is not real DOM')
    assert(await page.locator('.hero-phone-composite--mobile').evaluate((node) => getComputedStyle(node).display !== 'none'), 'production mobile hero Phone was incorrectly hidden')

    await assertResponsiveScale(page, 760, 900, 'mobile', 704, 9660)
    await assertResponsiveScale(page, 430, 932, 'mobile', 704, 9660)
    await assertResponsiveScale(page, 390, 844, 'mobile', 704, 9660)
    await assertResponsiveScale(page, 320, 700, 'mobile', 704, 9660)
    console.log('Live current Figma frontend passed: pinned left desktop sign-in, independently scrolling right column, interactive phones, current geometry, links, and responsive scaling.')
  } finally { await page.close() }
}

try {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { await runLiveChecks(); lastError = null; break }
    catch (error) { lastError = error; console.log(`Live check ${attempt}/${attempts} failed: ${error.message}`); if (attempt < attempts) await sleep(delayMs) }
  }
  if (lastError) throw lastError
} finally { await browser.close() }
