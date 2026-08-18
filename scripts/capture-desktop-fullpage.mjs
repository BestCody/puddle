import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const baseUrl = process.env.LANDING_CAPTURE_URL || 'http://127.0.0.1:3000/'
const artifacts = resolve(process.cwd(), 'landing-artifacts')
const cases = [
  [2560, 1440],
  [1920, 1080],
  [1648, 928],
  [1600, 900],
  [1536, 864],
  [1440, 900],
  [1366, 768],
  [1280, 600],
  [1024, 768],
  [800, 600],
  [761, 900]
]

await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({ headless: true })

try {
  for (const [width, height] of cases) {
    const page = await browser.newPage({ viewport: { width, height } })
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 120000 })
    await page.evaluate(() => document.fonts?.ready)
    await page.waitForFunction(() => document.querySelector('.landing-stage--desktop')?.dataset.ready === 'true', null, { timeout: 30000 })

    const totalHeight = await page.evaluate(() => document.documentElement.scrollHeight)
    const step = Math.max(360, Math.floor(height * 0.72))
    for (let y = 0; y < totalHeight; y += step) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y)
      await page.waitForTimeout(180)
    }
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
    await page.waitForTimeout(1200)

    const iframeCount = await page.locator('.landing-stage--desktop .feature-phone-demo__frame').count()
    for (let i = 0; i < iframeCount; i += 1) {
      const frame = page.frames()[i + 1]
      if (!frame) continue
      try {
        await frame.waitForLoadState('domcontentloaded', { timeout: 10000 })
      } catch {}
    }

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.waitForTimeout(400)
    const output = join(artifacts, `desktop-${width}x${height}.png`)
    await page.screenshot({ path: output, fullPage: true, animations: 'disabled' })
    console.log(`captured ${width}x${height} -> ${output}`)
    await page.close()
  }
} finally {
  await browser.close()
}
