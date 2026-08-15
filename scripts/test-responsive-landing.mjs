import { createServer } from 'node:http'
import { open } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { chromium } from 'playwright'

const root = process.cwd()
const publicRoot = resolve(root, 'public')
const publicPrefix = `${publicRoot}${sep}`
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

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
    const body = await handle.readFile()
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    })
    response.end(body)
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not found')
  } finally {
    await handle?.close()
  }
})

function expectedWidth(testCase) {
  if (testCase.mode === 'desktop') return Math.min(testCase.width, 1281, testCase.height * 1.425)
  return Math.min(testCase.width, 704)
}

await new Promise((resolveListening) => server.listen(0, '127.0.0.1', resolveListening))
const address = server.address()
const baseUrl = `http://127.0.0.1:${address.port}/`
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

const cases = [
  { width: 1920, height: 1080, mode: 'desktop', sourceWidth: 1281, sourceHeight: 8736 },
  { width: 1440, height: 900, mode: 'desktop', sourceWidth: 1281, sourceHeight: 8736 },
  { width: 1366, height: 768, mode: 'desktop', sourceWidth: 1281, sourceHeight: 8736 },
  { width: 1280, height: 600, mode: 'desktop', sourceWidth: 1281, sourceHeight: 8736 },
  { width: 1024, height: 768, mode: 'desktop', sourceWidth: 1281, sourceHeight: 8736 },
  { width: 800, height: 600, mode: 'desktop', sourceWidth: 1281, sourceHeight: 8736 },
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

    const selector = `.figma-artboard--${testCase.mode}`
    const otherSelector = testCase.mode === 'desktop' ? '.figma-artboard--mobile' : '.figma-artboard--desktop'
    assert(await page.locator(selector).isVisible(), `${testCase.mode} artboard is hidden at ${testCase.width}x${testCase.height}`)
    assert(!(await page.locator(otherSelector).isVisible()), `wrong artboard is visible at ${testCase.width}x${testCase.height}`)

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

    const targetWidth = expectedWidth(testCase)
    const targetHeight = targetWidth * testCase.sourceHeight / testCase.sourceWidth
    assert(Math.abs(metrics.artboardWidth - targetWidth) < 1.1,
      `${testCase.mode} artboard width ${metrics.artboardWidth} does not match fit target ${targetWidth}px`)
    assert(Math.abs(metrics.imageWidth - targetWidth) < 1.1,
      `${testCase.mode} image width ${metrics.imageWidth} does not match fit target ${targetWidth}px`)
    assert(Math.abs(metrics.imageHeight - targetHeight) < 1.5,
      `${testCase.mode} aspect ratio changed at ${testCase.width}x${testCase.height}`)
    assert(Math.abs(metrics.left - metrics.right) < 1.1,
      `${testCase.mode} artboard is not centered at ${testCase.width}x${testCase.height}`)
    assert(metrics.scrollWidth <= metrics.viewportWidth,
      `${testCase.mode} page horizontally overflows at ${testCase.width}x${testCase.height}`)

    if (testCase.mode === 'desktop') {
      assert(metrics.artboardWidth <= 1281.6, 'desktop artboard upscaled beyond native Figma width')
      assert(metrics.artboardWidth <= testCase.height * 1.425 + 1.1, 'desktop artboard overfits a short viewport')
    } else {
      assert(metrics.artboardWidth <= 704.6, 'mobile artboard upscaled beyond native Figma width')
    }
  }

  console.log('Section-fit responsive Figma landing passed across desktop and mobile viewport sizes.')
} finally {
  await page.close()
  await browser.close()
  await new Promise((resolveClosing) => server.close(resolveClosing))
}
