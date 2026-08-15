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

await new Promise((resolveListening) => server.listen(0, '127.0.0.1', resolveListening))
const address = server.address()
const baseUrl = `http://127.0.0.1:${address.port}/`
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

const cases = [
  { width: 1920, mode: 'desktop', sourceWidth: 1281, sourceHeight: 8736 },
  { width: 1440, mode: 'desktop', sourceWidth: 1281, sourceHeight: 8736 },
  { width: 1024, mode: 'desktop', sourceWidth: 1281, sourceHeight: 8736 },
  { width: 800, mode: 'desktop', sourceWidth: 1281, sourceHeight: 8736 },
  { width: 760, mode: 'mobile', sourceWidth: 704, sourceHeight: 9660 },
  { width: 704, mode: 'mobile', sourceWidth: 704, sourceHeight: 9660 },
  { width: 430, mode: 'mobile', sourceWidth: 704, sourceHeight: 9660 },
  { width: 390, mode: 'mobile', sourceWidth: 704, sourceHeight: 9660 },
  { width: 320, mode: 'mobile', sourceWidth: 704, sourceHeight: 9660 }
]

try {
  for (const testCase of cases) {
    await page.setViewportSize({ width: testCase.width, height: 900 })
    await page.goto(baseUrl, { waitUntil: 'networkidle' })

    const selector = `.figma-artboard--${testCase.mode}`
    const otherSelector = testCase.mode === 'desktop' ? '.figma-artboard--mobile' : '.figma-artboard--desktop'
    assert(await page.locator(selector).isVisible(), `${testCase.mode} artboard is hidden at ${testCase.width}px`)
    assert(!(await page.locator(otherSelector).isVisible()), `wrong artboard is visible at ${testCase.width}px`)

    const metrics = await page.locator(selector).evaluate((node) => {
      const image = node.querySelector('img')
      const nodeRect = node.getBoundingClientRect()
      const imageRect = image.getBoundingClientRect()
      return {
        viewportWidth: document.documentElement.clientWidth,
        artboardWidth: nodeRect.width,
        imageWidth: imageRect.width,
        imageHeight: imageRect.height,
        scrollWidth: document.documentElement.scrollWidth
      }
    })

    const expectedHeight = metrics.viewportWidth * testCase.sourceHeight / testCase.sourceWidth
    assert(Math.abs(metrics.artboardWidth - metrics.viewportWidth) < 0.6,
      `${testCase.mode} artboard width ${metrics.artboardWidth} does not fill ${metrics.viewportWidth}px viewport`)
    assert(Math.abs(metrics.imageWidth - metrics.viewportWidth) < 0.6,
      `${testCase.mode} image width ${metrics.imageWidth} does not fill ${metrics.viewportWidth}px viewport`)
    assert(Math.abs(metrics.imageHeight - expectedHeight) < 1.1,
      `${testCase.mode} aspect ratio changed at ${testCase.width}px: ${metrics.imageHeight}px vs ${expectedHeight}px`)
    assert(metrics.scrollWidth <= metrics.viewportWidth,
      `${testCase.mode} page horizontally overflows at ${testCase.width}px`)
  }

  console.log('Responsive Figma landing passed across desktop and mobile viewport sizes without changing aspect ratio.')
} finally {
  await page.close()
  await browser.close()
  await new Promise((resolveClosing) => server.close(resolveClosing))
}
