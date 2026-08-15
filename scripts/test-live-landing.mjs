import { chromium } from 'playwright'
import sharp from 'sharp'
import { join } from 'node:path'

const landingUrl = process.env.LANDING_URL || 'https://puddle.you/'
const attempts = Number(process.env.LANDING_TEST_ATTEMPTS || 3)
const delayMs = Number(process.env.LANDING_TEST_DELAY_MS || 10000)
const root = process.cwd()
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const browser = await chromium.launch({ headless: true })
let lastError

async function visualDifference(referencePath, screenshotBuffer) {
  const reference = await sharp(referencePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const screenshot = await sharp(screenshotBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert(reference.info.width === screenshot.info.width && reference.info.height === screenshot.info.height,
    `live screenshot dimensions differ: ${screenshot.info.width}x${screenshot.info.height}, expected ${reference.info.width}x${reference.info.height}`)
  let changed = 0
  let absoluteError = 0
  const pixels = reference.info.width * reference.info.height
  for (let offset = 0; offset < reference.data.length; offset += 4) {
    let pixelChanged = false
    for (let channel = 0; channel < 4; channel += 1) {
      const error = Math.abs(reference.data[offset + channel] - screenshot.data[offset + channel])
      absoluteError += error
      if (error !== 0) pixelChanged = true
    }
    if (pixelChanged) changed += 1
  }
  return { rawChangedRatio: changed / pixels, mae: absoluteError / (pixels * 4 * 255) }
}

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
  assert(await page.locator(canvasSelector).isVisible(), `${mode} canvas is hidden at ${width}x${height}`)
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

async function runLiveChecks() {
  const page = await browser.newPage({ viewport: { width: 1281, height: 900 } })
  try {
    const separator = landingUrl.includes('?') ? '&' : '?'
    await page.goto(`${landingUrl}${separator}figma-live=${Date.now()}`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.evaluate(() => document.fonts?.ready)
    await page.waitForFunction(() => document.querySelector('.landing-stage--desktop')?.dataset.ready === 'true')

    assert(await page.locator('[data-figma-node="83:76"]').isVisible(), 'desktop real-DOM Figma canvas is not live')
    assert(!(await page.locator('[data-figma-node="161:116"]').isVisible()), 'mobile canvas is visible on desktop')
    assert(await page.locator('img[src="/figma/landing-desktop.png"]').count() === 0, 'production still renders the full desktop Figma screenshot')
    assert(await page.locator('img[src="/figma/landing-mobile.png"]').count() === 0, 'production still renders the full mobile Figma screenshot')
    assert(await page.locator('.login-panel input').count() === 2, 'production desktop login is not real form markup')
    assert(await page.locator('.feature-card--d-swipe').isVisible(), 'production desktop Swipe card is not real DOM')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'desktop landing horizontally overflows')

    const desktopScreenshot = await page.screenshot({ fullPage: true })
    const desktopDiff = await visualDifference(join(root, 'public/figma/landing-desktop.png'), desktopScreenshot)
    assert(desktopDiff.mae < 0.03, `desktop live genuine frontend exceeds Figma fidelity budget at normalized MAE ${(desktopDiff.mae * 100).toFixed(5)}%`)
    for (const path of ['/signin', '/signup', '/privacy', '/terms']) assert(await page.locator(`a[href="${path}"]`).count() > 0, `${path} link is missing from landing page`)

    await assertResponsiveScale(page, 1920, 1080, 'desktop', 1281, 8736)
    await assertResponsiveScale(page, 1440, 900, 'desktop', 1281, 8736)
    await assertResponsiveScale(page, 1366, 768, 'desktop', 1281, 8736)
    await assertResponsiveScale(page, 1280, 600, 'desktop', 1281, 8736)
    await assertResponsiveScale(page, 1024, 768, 'desktop', 1281, 8736)
    await assertResponsiveScale(page, 800, 600, 'desktop', 1281, 8736)

    await page.setViewportSize({ width: 704, height: 900 })
    await page.goto(`${landingUrl}${separator}figma-mobile=${Date.now()}`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.evaluate(() => document.fonts?.ready)
    await page.waitForFunction(() => document.querySelector('.landing-stage--mobile')?.dataset.ready === 'true')
    assert(await page.locator('[data-figma-node="161:116"]').isVisible(), 'mobile real-DOM Figma canvas is not live')
    assert(!(await page.locator('[data-figma-node="83:76"]').isVisible()), 'desktop canvas is visible on mobile')
    assert(await page.locator('.mobile-jump').isVisible(), 'mobile Jump In is not a real control')
    assert(await page.locator('.feature-card--m-swipe').isVisible(), 'production mobile Swipe card is not real DOM')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile landing horizontally overflows')

    const mobileScreenshot = await page.screenshot({ fullPage: true })
    const mobileDiff = await visualDifference(join(root, 'public/figma/landing-mobile.png'), mobileScreenshot)
    assert(mobileDiff.mae < 0.035, `mobile live genuine frontend exceeds Figma fidelity budget at normalized MAE ${(mobileDiff.mae * 100).toFixed(5)}%`)

    await assertResponsiveScale(page, 760, 900, 'mobile', 704, 9660)
    await assertResponsiveScale(page, 430, 932, 'mobile', 704, 9660)
    await assertResponsiveScale(page, 390, 844, 'mobile', 704, 9660)
    await assertResponsiveScale(page, 320, 700, 'mobile', 704, 9660)
    console.log(`Live genuine Figma frontend passed: desktop normalized MAE ${(desktopDiff.mae * 100).toFixed(5)}% (raw changed pixels ${(desktopDiff.rawChangedRatio * 100).toFixed(5)}%), mobile normalized MAE ${(mobileDiff.mae * 100).toFixed(5)}% (raw changed pixels ${(mobileDiff.rawChangedRatio * 100).toFixed(5)}%); responsive real-DOM scaling passed.`)
  } finally { await page.close() }
}

try {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { await runLiveChecks(); lastError = null; break }
    catch (error) { lastError = error; console.log(`Live check ${attempt}/${attempts} failed: ${error.message}`); if (attempt < attempts) await sleep(delayMs) }
  }
  if (lastError) throw lastError
} finally { await browser.close() }
