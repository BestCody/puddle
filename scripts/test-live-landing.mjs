import { chromium } from 'playwright'
import sharp from 'sharp'
import { join } from 'node:path'

const landingUrl = process.env.LANDING_URL || 'https://puddle.you/'
const attempts = Number(process.env.LANDING_TEST_ATTEMPTS || 3)
const delayMs = Number(process.env.LANDING_TEST_DELAY_MS || 10000)
const root = process.cwd()

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const browser = await chromium.launch({ headless: true })
let lastError

async function changedPixelRatio(referencePath, screenshotBuffer) {
  const reference = await sharp(referencePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const screenshot = await sharp(screenshotBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert(reference.info.width === screenshot.info.width && reference.info.height === screenshot.info.height,
    `live screenshot dimensions differ: ${screenshot.info.width}x${screenshot.info.height}, expected ${reference.info.width}x${reference.info.height}`)

  let changed = 0
  const pixels = reference.info.width * reference.info.height
  for (let offset = 0; offset < reference.data.length; offset += 4) {
    if (reference.data[offset] !== screenshot.data[offset] ||
        reference.data[offset + 1] !== screenshot.data[offset + 1] ||
        reference.data[offset + 2] !== screenshot.data[offset + 2] ||
        reference.data[offset + 3] !== screenshot.data[offset + 3]) changed += 1
  }
  return changed / pixels
}

function targetResponsiveWidth(width, height, mode) {
  return mode === 'desktop' ? Math.min(width, 1281, height * 1.4) : Math.min(width, 704)
}

async function assertResponsiveScale(page, width, height, mode, sourceWidth, sourceHeight) {
  await page.setViewportSize({ width, height })
  const separator = landingUrl.includes('?') ? '&' : '?'
  await page.goto(`${landingUrl}${separator}responsive=${mode}-${width}x${height}-${Date.now()}`, { waitUntil: 'networkidle', timeout: 30000 })

  const selector = `.figma-artboard--${mode}`
  const otherSelector = mode === 'desktop' ? '.figma-artboard--mobile' : '.figma-artboard--desktop'
  assert(await page.locator(selector).isVisible(), `${mode} artboard is hidden at ${width}x${height}`)
  assert(!(await page.locator(otherSelector).isVisible()), `wrong artboard is visible at ${width}x${height}`)

  const metrics = await page.locator(selector).evaluate((node) => {
    const image = node.querySelector('img')
    const nodeRect = node.getBoundingClientRect()
    const imageRect = image.getBoundingClientRect()
    return {
      viewportWidth: document.documentElement.clientWidth,
      artboardWidth: nodeRect.width,
      imageWidth: imageRect.width,
      imageHeight: imageRect.height,
      left: nodeRect.left,
      right: document.documentElement.clientWidth - nodeRect.right,
      scrollWidth: document.documentElement.scrollWidth
    }
  })

  const targetWidth = targetResponsiveWidth(width, height, mode)
  const expectedHeight = targetWidth * sourceHeight / sourceWidth
  assert(Math.abs(metrics.artboardWidth - targetWidth) < 1.1,
    `${mode} artboard width ${metrics.artboardWidth} does not match fit target ${targetWidth}px`)
  assert(Math.abs(metrics.imageWidth - targetWidth) < 1.1,
    `${mode} image width ${metrics.imageWidth} does not match fit target ${targetWidth}px`)
  assert(Math.abs(metrics.imageHeight - expectedHeight) < 1.5,
    `${mode} aspect ratio changed at ${width}x${height}`)
  assert(Math.abs(metrics.left - metrics.right) < 1.1,
    `${mode} artboard is not centered at ${width}x${height}`)
  assert(metrics.scrollWidth <= metrics.viewportWidth, `${mode} page horizontally overflows at ${width}x${height}`)
}

async function runLiveChecks() {
  const page = await browser.newPage({ viewport: { width: 1281, height: 900 } })
  try {
    const separator = landingUrl.includes('?') ? '&' : '?'
    await page.goto(`${landingUrl}${separator}figma-live=${Date.now()}`, { waitUntil: 'networkidle', timeout: 30000 })

    assert(await page.locator('[data-figma-node="83:76"]').isVisible(), 'desktop Figma 83:76 artboard is not live')
    assert(!(await page.locator('[data-figma-node="161:116"]').isVisible()), 'mobile artboard is visible on desktop')
    const desktopNatural = await page.locator('.figma-artboard--desktop img').evaluate((img) => [img.naturalWidth, img.naturalHeight])
    assert(desktopNatural[0] === 1281 && desktopNatural[1] === 8736, `desktop export is ${desktopNatural.join('x')}, expected 1281x8736`)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'desktop landing horizontally overflows')

    const desktopScreenshot = await page.screenshot({ fullPage: true })
    const desktopDiff = await changedPixelRatio(join(root, 'public/figma/landing-desktop.png'), desktopScreenshot)
    assert(desktopDiff < 0.0001, `desktop live page differs from Figma at ${(desktopDiff * 100).toFixed(5)}% of pixels`)

    for (const path of ['/signin', '/signup', '/privacy', '/terms']) {
      assert(await page.locator(`a[href="${path}"]`).count() > 0, `${path} link is missing from the landing page`)
    }

    await assertResponsiveScale(page, 1920, 1080, 'desktop', 1281, 8736)
    await assertResponsiveScale(page, 1440, 900, 'desktop', 1281, 8736)
    await assertResponsiveScale(page, 1366, 768, 'desktop', 1281, 8736)
    await assertResponsiveScale(page, 1280, 600, 'desktop', 1281, 8736)
    await assertResponsiveScale(page, 1024, 768, 'desktop', 1281, 8736)
    await assertResponsiveScale(page, 800, 600, 'desktop', 1281, 8736)

    await page.setViewportSize({ width: 704, height: 900 })
    await page.goto(`${landingUrl}${separator}figma-mobile=${Date.now()}`, { waitUntil: 'networkidle', timeout: 30000 })

    assert(await page.locator('[data-figma-node="161:116"]').isVisible(), 'mobile Figma 161:116 artboard is not live')
    assert(!(await page.locator('[data-figma-node="83:76"]').isVisible()), 'desktop artboard is visible on mobile')
    const mobileNatural = await page.locator('.figma-artboard--mobile img').evaluate((img) => [img.naturalWidth, img.naturalHeight])
    assert(mobileNatural[0] === 704 && mobileNatural[1] === 9660, `mobile export is ${mobileNatural.join('x')}, expected 704x9660`)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile landing horizontally overflows')

    await page.evaluate(() => window.scrollTo(0, 1))
    await page.waitForTimeout(500)
    assert(await page.locator('.figma-artboard--mobile').evaluate((node) => node.classList.contains('has-scrolled')), 'mobile Jump In state did not activate after scroll')

    const mobileScreenshot = await page.screenshot({ fullPage: true })
    const mobileDiff = await changedPixelRatio(join(root, 'public/figma/landing-mobile.png'), mobileScreenshot)
    assert(mobileDiff < 0.0001, `mobile live page differs from Figma at ${(mobileDiff * 100).toFixed(5)}% of pixels`)

    await assertResponsiveScale(page, 760, 900, 'mobile', 704, 9660)
    await assertResponsiveScale(page, 430, 932, 'mobile', 704, 9660)
    await assertResponsiveScale(page, 390, 844, 'mobile', 704, 9660)
    await assertResponsiveScale(page, 320, 700, 'mobile', 704, 9660)

    console.log(`Live Figma verification passed: desktop diff ${(desktopDiff * 100).toFixed(5)}%, mobile diff ${(mobileDiff * 100).toFixed(5)}%; section-fit responsive scaling passed.`)
  } finally {
    await page.close()
  }
}

try {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await runLiveChecks()
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
