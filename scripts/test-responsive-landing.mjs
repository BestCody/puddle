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

function expectedWidth(testCase) {
  if (testCase.mode === 'desktop') return Math.min(testCase.width, 1281, testCase.height * 1.425)
  return Math.min(testCase.width, 704)
}

await new Promise((resolveListening) => server.listen(0, '127.0.0.1', resolveListening))
const baseUrl = `http://127.0.0.1:${server.address().port}/`
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const cases = [
  { width: 1920, height: 1080, mode: 'desktop', sourceWidth: 1281, sourceHeight: 7578 },
  { width: 1440, height: 900, mode: 'desktop', sourceWidth: 1281, sourceHeight: 7578 },
  { width: 1366, height: 768, mode: 'desktop', sourceWidth: 1281, sourceHeight: 7578 },
  { width: 1280, height: 600, mode: 'desktop', sourceWidth: 1281, sourceHeight: 7578 },
  { width: 1024, height: 768, mode: 'desktop', sourceWidth: 1281, sourceHeight: 7578 },
  { width: 800, height: 600, mode: 'desktop', sourceWidth: 1281, sourceHeight: 7578 },
  { width: 760, height: 900, mode: 'mobile', sourceWidth: 704, sourceHeight: 9660 },
  { width: 704, height: 900, mode: 'mobile', sourceWidth: 704, sourceHeight: 9660 },
  { width: 430, height: 932, mode: 'mobile', sourceWidth: 704, sourceHeight: 9660 },
  { width: 390, height: 844, mode: 'mobile', sourceWidth: 704, sourceHeight: 9660 },
  { width: 320, height: 700, mode: 'mobile', sourceWidth: 704, sourceHeight: 9660 }
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
      const sticky = document.querySelector('.landing-sticky-left')
      const stageRect = stage.getBoundingClientRect()
      const canvasRect = canvas.getBoundingClientRect()
      const stickyRect = sticky?.getBoundingClientRect() || null
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
        sticky: stickyRect ? { left: stickyRect.left, top: stickyRect.top, width: stickyRect.width, height: stickyRect.height, display: getComputedStyle(sticky).display } : null
      }
    })

    const targetWidth = expectedWidth(testCase)
    const targetHeight = targetWidth * testCase.sourceHeight / testCase.sourceWidth
    assert(Math.abs(metrics.stageWidth - targetWidth) < 1.1, `${testCase.mode} stage width ${metrics.stageWidth} does not match ${targetWidth}`)
    assert(Math.abs(metrics.canvasWidth - targetWidth) < 1.1, `${testCase.mode} canvas width ${metrics.canvasWidth} does not match ${targetWidth}`)
    assert(Math.abs(metrics.stageHeight - targetHeight) < 1.5, `${testCase.mode} stage aspect ratio changed at ${testCase.width}x${testCase.height}`)
    assert(Math.abs(metrics.canvasHeight - targetHeight) < 1.5, `${testCase.mode} canvas aspect ratio changed at ${testCase.width}x${testCase.height}`)
    assert(Math.abs(metrics.left - metrics.right) < 1.1, `${testCase.mode} stage is not centered at ${testCase.width}x${testCase.height}`)
    assert(metrics.scrollWidth <= metrics.viewportWidth, `${testCase.mode} page horizontally overflows at ${testCase.width}x${testCase.height}`)

    if (testCase.mode === 'desktop') {
      const scale = targetWidth / 1281
      assert(metrics.stageWidth <= 1281.6, 'desktop stage upscaled beyond native Figma width')
      assert(metrics.stageWidth <= testCase.height * 1.425 + 1.1, 'desktop stage overfits a short viewport')
      assert(metrics.sticky?.display !== 'none', 'desktop sticky left pane is hidden')
      assert(Math.abs(metrics.sticky.left - metrics.left) < 1.1, 'sticky left pane is not aligned to the centered Figma stage')
      assert(Math.abs(metrics.sticky.top) < 1.1, 'sticky left pane is not pinned to the viewport top')
      assert(Math.abs(metrics.sticky.width - 615 * scale) < 1.1, 'sticky left pane width does not track Figma scale')
      assert(Math.abs(metrics.sticky.height - metrics.viewportHeight) < 1.1, 'sticky left pane does not cover the viewport height')
    } else {
      assert(metrics.stageWidth <= 704.6, 'mobile stage upscaled beyond native Figma width')
      assert(!metrics.sticky || metrics.sticky.display === 'none', 'desktop sticky pane leaked into mobile layout')
    }
  }
  console.log('Responsive Figma landing passed: desktop sticky split, right-side canvas scaling, and mobile single-column scaling are correct.')
} finally {
  await page.close()
  await browser.close()
  await new Promise((resolveClosing) => server.close(resolveClosing))
}
