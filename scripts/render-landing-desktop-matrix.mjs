import { createServer } from 'node:http'
import { mkdir, open } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { chromium } from 'playwright'

const publicRoot = resolve(process.cwd(), 'public')
const publicPrefix = `${publicRoot}${sep}`
const outputRoot = resolve(process.cwd(), 'landing-artifacts', 'desktop-matrix')
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

const cases = [
  { width: 2560, height: 1440 },
  { width: 1920, height: 1080 },
  { width: 1648, height: 928 },
  { width: 1600, height: 900 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 600 },
  { width: 1024, height: 768 },
  { width: 800, height: 600 },
  { width: 761, height: 900 }
]

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
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    })
    response.end(await handle.readFile())
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not found')
  } finally {
    await handle?.close()
  }
})

await mkdir(outputRoot, { recursive: true })
await new Promise((resolveListening) => server.listen(0, '127.0.0.1', resolveListening))
const baseUrl = `http://127.0.0.1:${server.address().port}/`
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

try {
  for (const testCase of cases) {
    await page.setViewportSize(testCase)
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts?.ready)
    await page.waitForFunction(() => document.querySelector('.landing-stage--desktop')?.dataset.ready === 'true')
    await page.screenshot({
      path: resolve(outputRoot, `${testCase.width}x${testCase.height}.jpg`),
      fullPage: true,
      type: 'jpeg',
      quality: 78
    })
    console.log(`Rendered ${testCase.width}x${testCase.height}`)
  }
} finally {
  await page.close()
  await browser.close()
  await new Promise((resolveClosing) => server.close(resolveClosing))
}
