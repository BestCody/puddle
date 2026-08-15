import { chromium } from 'playwright'
import sharp from 'sharp'
import { join } from 'node:path'

const landingUrl = process.env.LANDING_URL || 'https://puddle.you/'
const attempts = Number(process.env.LANDING_TEST_ATTEMPTS || 12)
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

async function runLiveChecks() {
  const page = await browser.newPage({ viewport: { width: 1281, height: 900 } })
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })

  try {
    const separator = landingUrl.includes('?') ? '&' : '?'
    await page.goto(`${landingUrl}${separator}figma-live=${Date.now()}`, { waitUntil: 'networkidle', timeout: 30000 })

    assert(await page.locator('[data-figma-node="83:76"]').isVisible(), 'desktop Figma 83:76 artboard is not live yet')
    assert(!(await page.locator('[data-figma-node="161:116"]').isVisible()), 'mobile artboard should be hidden on desktop')
    const desktopNatural = await page.locator('.figma-artboard--desktop img').evaluate((img) => [img.naturalWidth, img.naturalHeight])
    assert(desktopNatural[0] === 1281 && desktopNatural[1] === 8736, `desktop export is ${desktopNatural.join('x')}`)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'desktop landing horizontally overflows')

    const desktopScreenshot = await page.screenshot({ fullPage: true })
    const desktopDiff = await changedPixelRatio(join(root, 'public/figma/landing-desktop.png'), desktopScreenshot)
    assert(desktopDiff < 0.0001, `desktop live page differs from Figma at ${(desktopDiff * 100).toFixed(5)}% of pixels`)

    for (const path of ['/signin', '/signup', '/privacy', '/terms']) {
      assert(await page.locator(`a[href="${path}"]`).count() > 0, `${path} native route link is missing`)
    }

    await page.locator('.d-safety-button').click()
    assert(await page.locator('#safety-dialog-backdrop.is-open').isVisible(), 'safety dialog did not open')
    await page.locator('[data-close-safety]').click()
    assert(!(await page.locator('#safety-dialog-backdrop').isVisible()), 'safety dialog did not close')

    await page.setViewportSize({ width: 704, height: 900 })
    await page.goto(`${landingUrl}${separator}figma-mobile=${Date.now()}`, { waitUntil: 'networkidle', timeout: 30000 })
    assert(await page.locator('[data-figma-node="161:116"]').isVisible(), 'mobile Figma 161:116 artboard is not live yet')
    assert(!(await page.locator('[data-figma-node="83:76"]').isVisible()), 'desktop artboard should be hidden on mobile')
    const mobileNatural = await page.locator('.figma-artboard--mobile img').evaluate((img) => [img.naturalWidth, img.naturalHeight])
    assert(mobileNatural[0] === 704 && mobileNatural[1] === 9660, `mobile export is ${mobileNatural.join('x')}`)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile landing horizontally overflows')
    assert(await page.locator('.mobile-jump-mask').evaluate((node) => getComputedStyle(node).opacity) === '1', 'Jump In is visible before mobile scroll')
    await page.evaluate(() => window.scrollTo(0, 1))
    await page.waitForTimeout(500)
    assert(await page.locator('.figma-artboard--mobile').evaluate((node) => node.classList.contains('has-scrolled')), 'Jump In did not fade in after mobile scroll')

    const mobileScreenshot = await page.screenshot({ fullPage: true })
    const mobileDiff = await changedPixelRatio(join(root, 'public/figma/landing-mobile.png'), mobileScreenshot)
    assert(mobileDiff < 0.0001, `mobile live page differs from Figma at ${(mobileDiff * 100).toFixed(5)}% of pixels`)

    for (const auth of [
      { path: '/signin', title: 'Discover places. See who’s there.' },
      { path: '/signup', title: 'Make plans that leave the chat.' }
    ]) {
      await page.goto(new URL(auth.path, landingUrl).href, { waitUntil: 'networkidle', timeout: 30000 })
      assert((await page.locator('h1').textContent())?.trim() === auth.title, `${auth.path} route changed unexpectedly`)
    }

    assert(browserErrors.length === 0, `live browser errors:\n${browserErrors.join('\n')}`)
    console.log(`Live Figma verification passed: desktop diff ${(desktopDiff * 100).toFixed(5)}%, mobile diff ${(mobileDiff * 100).toFixed(5)}%.`)
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
