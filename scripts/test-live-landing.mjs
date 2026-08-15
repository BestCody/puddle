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
  const canvasSelector = `.landing-canvas--${mode}`
  const otherStage = mode === 'desktop' ? '.landing-stage--mobile' : '.landing-stage--desktop'
  await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.ready === 'true', stageSelector)
  assert(await page.locator(stageSelector).isVisible(), `${mode} stage is hidden at ${width}x${height}`)
  assert(!(await page.locator(otherStage).isVisible()), `wrong stage is visible at ${width}x${height}`)
  const metrics = await page.locator(stageSelector).evaluate((stage) => {
    const canvas = stage.querySelector('.landing-canvas')
    const stageRect = stage.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    return { viewportWidth: document.documentElement.clientWidth, stageWidth: stageRect.width, stageHeight: stageRect.height, canvasWidth: canvasRect.width, canvasHeight: canvasRect.height, left: stageRect.left, right: document.documentElement.clientWidth - stageRect.right, scrollWidth: document.documentElement.scrollWidth }
  })
  const targetWidth = targetResponsiveWidth(width, height, mode)
  const expectedHeight = targetWidth * sourceHeight / sourceWidth
  assert(Math.abs(metrics.stageWidth - targetWidth) < 1.1, `${mode} stage width ${metrics.stageWidth} does not match fit target ${targetWidth}px`)
  assert(Math.abs(metrics.canvasWidth - targetWidth) < 1.1, `${mode} canvas width ${metrics.canvasWidth} does not match fit target ${targetWidth}px`)
  assert(Math.abs(metrics.stageHeight - expectedHeight) < 1.5, `${mode} stage aspect ratio changed at ${width}x${height}`)
  assert(Math.abs(metrics.canvasHeight - expectedHeight) < 1.5, `${mode} canvas aspect ratio changed at ${width}x${height}`)
  assert(Math.abs(metrics.left - metrics.right) < 1.1, `${mode} stage is not centered at ${width}x${height}`)
  assert(metrics.scrollWidth <= metrics.viewportWidth, `${mode} page horizontally overflows at ${width}x${height}`)
}

async function cssBox(page, selector) {
  return page.locator(selector).evaluate((node) => {
    const style = getComputedStyle(node)
    return { left: Number.parseFloat(style.left), top: Number.parseFloat(style.top), width: Number.parseFloat(style.width), height: Number.parseFloat(style.height) }
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
    assert(await page.locator('img[src="/figma/landing-mobile.png"]').count() === 0, 'production renders the old full mobile Figma screenshot')
    assert(await page.locator('.login-panel input').count() === 2, 'production desktop login is not real form markup')
    assertBox(await cssBox(page, '.discovery--desktop .city-photo-wrap'), { left: 0, top: 860, width: 1291, height: 2449 }, 'production blue artwork')
    assertBox(await cssBox(page, '.feature-card--d-swipe'), { left: 367, top: 1715, width: 550, height: 896 }, 'production Swipe card')
    const profileBackdrop = await cssBox(page, '.profile-backdrop--desktop')
    assertBox(profileBackdrop, { left: 298, top: 4543, width: 685, height: 971 }, 'production Profile backdrop')
    assertBox(await cssBox(page, '.feature-card--d-profile'), { left: 378, top: 4561, width: 550, height: 898 }, 'production Profile card')
    const lockBox = await cssBox(page, '.trust-heading--desktop img')
    assertBox(lockBox, { left: 594, top: 5557, width: 92.395, height: 92.395 }, 'production Lock')
    assert(profileBackdrop.top + profileBackdrop.height < lockBox.top, 'production Profile white backdrop leaks behind the Lock')
    const fidelity = await page.evaluate(() => {
      const backdrop = document.querySelector('.profile-backdrop--desktop')
      const trust = document.querySelector('.trust-heading--desktop')
      const lock = trust?.querySelector('img')
      return {
        profile: backdrop ? getComputedStyle(backdrop).backgroundColor : null,
        trust: trust ? getComputedStyle(trust).backgroundColor : null,
        lock: lock ? getComputedStyle(lock).backgroundColor : null,
        lockSrc: lock?.getAttribute('src') || null
      }
    })
    assert(fidelity.profile === 'rgb(255, 255, 255)', `production Profile backdrop is ${fidelity.profile}`)
    assert(fidelity.trust === 'rgba(0, 0, 0, 0)', `production trust background is ${fidelity.trust}`)
    assert(fidelity.lock === 'rgba(0, 0, 0, 0)', `production Lock background is ${fidelity.lock}`)
    assert(fidelity.lockSrc === '/figma/assets/lock.svg', `production Lock is using ${fidelity.lockSrc}`)
    assertBox(await cssBox(page, '.safety-panel--desktop'), { left: 325, top: 5877, width: 631, height: 1530 }, 'production safety panel')
    for (const path of ['/signin', '/signup', '/privacy', '/terms']) assert(await page.locator(`a[href="${path}"]`).count() > 0, `${path} link is missing from landing page`)

    await assertResponsiveScale(page, 1920, 1080, 'desktop', 1281, 8736)
    await assertResponsiveScale(page, 1440, 900, 'desktop', 1281, 8736)
    await assertResponsiveScale(page, 1366, 768, 'desktop', 1281, 8736)
    await assertResponsiveScale(page, 1024, 768, 'desktop', 1281, 8736)
    await assertResponsiveScale(page, 800, 600, 'desktop', 1281, 8736)

    await page.setViewportSize({ width: 704, height: 900 })
    await page.goto(`${landingUrl}${separator}figma-mobile=${Date.now()}`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.evaluate(() => document.fonts?.ready)
    await page.waitForFunction(() => document.querySelector('.landing-stage--mobile')?.dataset.ready === 'true')
    assert(await page.locator('[data-figma-node="161:116"]').isVisible(), 'mobile real-DOM Figma canvas is not live')
    assert(!(await page.locator('[data-figma-node="83:76"]').isVisible()), 'desktop canvas is visible on mobile')
    assert(await page.locator('.feature-card--m-swipe').isVisible(), 'production mobile Swipe card is not real DOM')
    assert(await page.locator('.trust-heading--mobile img').getAttribute('src') === '/figma/assets/lock.svg', 'production mobile Lock is not the transparent Figma SVG')
    const jump = page.locator('.mobile-jump')
    assert(await jump.getAttribute('aria-hidden') === 'true', 'production Jump In must start hidden')
    await page.evaluate(() => window.scrollTo(0, 80))
    await page.waitForFunction(() => document.querySelector('.landing-canvas--mobile')?.classList.contains('is-scrolled'))
    assert(await jump.getAttribute('aria-hidden') === 'false', 'production Jump In must appear after scroll')

    await assertResponsiveScale(page, 760, 900, 'mobile', 704, 9660)
    await assertResponsiveScale(page, 430, 932, 'mobile', 704, 9660)
    await assertResponsiveScale(page, 390, 844, 'mobile', 704, 9660)
    await assertResponsiveScale(page, 320, 700, 'mobile', 704, 9660)
    console.log('Live current Figma frontend passed: genuine DOM, Profile backdrop, transparent Lock, geometry, mobile Jump In, links, and responsive scaling passed.')
  } finally { await page.close() }
}

try {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { await runLiveChecks(); lastError = null; break }
    catch (error) { lastError = error; console.log(`Live check ${attempt}/${attempts} failed: ${error.message}`); if (attempt < attempts) await sleep(delayMs) }
  }
  if (lastError) throw lastError
} finally { await browser.close() }
