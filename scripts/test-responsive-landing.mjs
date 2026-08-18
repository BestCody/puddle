import { createServer } from 'node:http'
import { open } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { chromium } from 'playwright'

const publicRoot = resolve(process.cwd(), 'public')
const publicPrefix = `${publicRoot}${sep}`
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' }
const assert = (condition, message) => { if (!condition) throw new Error(message) }

const server = createServer(async (request, response) => {
  let handle
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    const requestedPath = url.pathname === '/' ? 'landing.html' : url.pathname.replace(/^\/+/, '')
    const filePath = resolve(publicRoot, requestedPath)
    if (filePath !== publicRoot && !filePath.startsWith(publicPrefix)) throw new Error('Path escapes public root')
    handle = await open(filePath, 'r')
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('Not a file')
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    response.end(await handle.readFile())
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not found')
  } finally { await handle?.close() }
})

await new Promise((resolveListening) => server.listen(0, '127.0.0.1', resolveListening))
const baseUrl = `http://127.0.0.1:${server.address().port}/`
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const cases = [
  { width: 2560, height: 1440, mode: 'desktop' },
  { width: 1920, height: 1080, mode: 'desktop' },
  { width: 1648, height: 928, mode: 'desktop' },
  { width: 1600, height: 900, mode: 'desktop' },
  { width: 1536, height: 864, mode: 'desktop' },
  { width: 1440, height: 900, mode: 'desktop' },
  { width: 1366, height: 768, mode: 'desktop' },
  { width: 1280, height: 600, mode: 'desktop' },
  { width: 1024, height: 768, mode: 'desktop' },
  { width: 800, height: 600, mode: 'desktop' },
  { width: 761, height: 900, mode: 'desktop' },
  { width: 760, height: 900, mode: 'mobile' },
  { width: 704, height: 900, mode: 'mobile' },
  { width: 430, height: 932, mode: 'mobile' },
  { width: 390, height: 844, mode: 'mobile' },
  { width: 320, height: 700, mode: 'mobile' }
]

try {
  for (const testCase of cases) {
    await page.setViewportSize({ width: testCase.width, height: testCase.height })
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    const stageSelector = `.landing-stage--${testCase.mode}`
    const otherStage = testCase.mode === 'desktop' ? '.landing-stage--mobile' : '.landing-stage--desktop'
    await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.ready === 'true', stageSelector)
    assert(await page.locator(stageSelector).isVisible(), `${testCase.mode} stage is hidden at ${testCase.width}x${testCase.height}`)
    assert(!(await page.locator(otherStage).isVisible()), `wrong stage is visible at ${testCase.width}x${testCase.height}`)

    const metrics = await page.locator(stageSelector).evaluate((stage) => {
      const canvas = stage.querySelector('.landing-canvas')
      const leftCell = document.querySelector('.landing-sticky-left')
      const stickyCanvas = document.querySelector('.landing-sticky-left__canvas')
      const stageRect = stage.getBoundingClientRect()
      const canvasRect = canvas.getBoundingClientRect()
      const leftRect = leftCell?.getBoundingClientRect() || null
      const stickyRect = stickyCanvas?.getBoundingClientRect() || null
      const canvasStyle = getComputedStyle(canvas)
      const stageStyle = getComputedStyle(stage)
      return {
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: window.innerHeight,
        stageWidth: stageRect.width,
        stageHeight: stageRect.height,
        canvasWidth: canvasRect.width,
        canvasHeight: canvasRect.height,
        left: stageRect.left,
        right: document.documentElement.clientWidth - stageRect.right,
        scrollWidth: document.documentElement.scrollWidth,
        stageDisplay: stageStyle.display,
        canvasPosition: canvasStyle.position,
        canvasTransform: canvasStyle.transform,
        leftCell: leftRect ? {
          left: leftRect.left,
          width: leftRect.width,
          display: getComputedStyle(leftCell).display,
          position: getComputedStyle(leftCell).position
        } : null,
        sticky: stickyRect ? {
          left: stickyRect.left,
          top: stickyRect.top,
          width: stickyRect.width,
          height: stickyRect.height,
          display: getComputedStyle(stickyCanvas).display,
          position: getComputedStyle(stickyCanvas).position
        } : null
      }
    })

    const targetWidth = Math.min(testCase.width, testCase.mode === 'desktop' ? 1440 : 704)
    assert(Math.abs(metrics.stageWidth - targetWidth) < 1.1, `${testCase.mode} stage width ${metrics.stageWidth} does not match fluid max-width ${targetWidth}`)
    assert(Math.abs(metrics.left - metrics.right) < 1.1, `${testCase.mode} stage is not centered at ${testCase.width}x${testCase.height}`)
    assert(metrics.scrollWidth <= metrics.viewportWidth, `${testCase.mode} page horizontally overflows at ${testCase.width}x${testCase.height}`)
    assert(metrics.canvasTransform === 'none', `${testCase.mode} canvas still uses global transform sizing at ${testCase.width}x${testCase.height}`)
    assert(metrics.canvasPosition !== 'absolute', `${testCase.mode} canvas is still absolutely positioned at ${testCase.width}x${testCase.height}`)
    assert(metrics.canvasHeight > testCase.height, `${testCase.mode} canvas does not grow naturally with document content`)

    if (testCase.mode === 'desktop') {
      assert(metrics.stageDisplay === 'grid', 'desktop landing is not using CSS Grid')
      assert(metrics.leftCell?.display !== 'none', 'desktop left grid cell is hidden')
      assert(metrics.leftCell?.position === 'relative', `desktop left grid cell uses ${metrics.leftCell?.position} instead of row-constrained relative flow`)
      assert(metrics.sticky?.position === 'sticky', `desktop sign-in canvas uses ${metrics.sticky?.position} instead of CSS sticky`)
      assert(Math.abs(metrics.leftCell.left - metrics.left) < 1.1, 'left grid cell is not aligned to the centered stage')
      assert(Math.abs(metrics.sticky.left - metrics.leftCell.left) < 1.1, 'sticky sign-in canvas is not aligned to its grid cell')
      assert(Math.abs(metrics.canvasWidth + metrics.leftCell.width - metrics.stageWidth) < 2, 'desktop columns do not fill the landing stage')
      const ratio = metrics.leftCell.width / metrics.stageWidth
      assert(ratio >= .43 && ratio <= .55, `desktop split ratio ${ratio} drifted too far from the Figma composition`)
    } else {
      assert(metrics.stageDisplay === 'block', 'mobile landing is not a single-column composition')
      assert(!metrics.leftCell || metrics.leftCell.width === 0 || !(await page.locator('.landing-sticky-left').isVisible()), 'desktop left pane leaked into mobile layout')
      assert(Math.abs(metrics.canvasWidth - metrics.stageWidth) < 1.1, 'mobile canvas is not fluid with its stage')
    }
  }
  console.log('Responsive Figma landing passed: 1440px canonical desktop composition, compact desktop continuity, mobile single column, normal-flow content, and no whole-canvas sizing transform.')
} finally {
  await page.close()
  await browser.close()
  await new Promise((resolveClosing) => server.close(resolveClosing))
}
