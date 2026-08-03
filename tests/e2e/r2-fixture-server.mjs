import http from 'node:http'
import {
  R2_FIXTURE_HOST,
  R2_FIXTURE_OBJECTS,
  R2_FIXTURE_PORT
} from './r2-fixture-data.mjs'

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)
const requests = []

function placeholderSvg(category) {
  const label = String(category || 'place').replaceAll('_', ' ')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="450" viewBox="0 0 720 450" role="img" aria-label="${label} placeholder"><rect width="720" height="450" fill="#e8e1e4"/><text x="360" y="235" text-anchor="middle" font-family="system-ui,sans-serif" font-size="32" fill="#51484d">${label}</text></svg>`
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || `${R2_FIXTURE_HOST}:${R2_FIXTURE_PORT}`}`)
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Cache-Control', url.pathname === '/catalogue/manifest.json'
    ? 'public, max-age=0, must-revalidate'
    : 'public, max-age=31536000, immutable')

  if (url.pathname === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ ok: true }))
    return
  }

  if (url.pathname === '/__requests') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify({ requests }))
    return
  }

  if (url.pathname === '/__reset' && request.method === 'POST') {
    requests.length = 0
    response.writeHead(204, { 'Cache-Control': 'no-store' })
    response.end()
    return
  }

  requests.push({ method: request.method || 'GET', path: url.pathname, at: new Date().toISOString() })
  if (requests.length > 2_000) requests.splice(0, requests.length - 2_000)

  if (url.pathname === '/photos/e2e-media.png') {
    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': ONE_PIXEL_PNG.length })
    response.end(ONE_PIXEL_PNG)
    return
  }

  if (/^\/catalogue\/placeholders\/[a-z0-9_-]+\.svg$/.test(url.pathname)) {
    const category = url.pathname.split('/').pop().replace(/\.svg$/, '')
    const body = placeholderSvg(category)
    response.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' })
    response.end(body)
    return
  }

  const object = R2_FIXTURE_OBJECTS.get(url.pathname)
  if (!object) {
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ error: 'fixture object not found', path: url.pathname }))
    return
  }

  response.writeHead(200, { 'Content-Type': object.contentType })
  response.end(object.body)
})

server.listen(R2_FIXTURE_PORT, R2_FIXTURE_HOST, () => {
  process.stdout.write(`R2 E2E fixture server listening on http://${R2_FIXTURE_HOST}:${R2_FIXTURE_PORT}\n`)
})

function close() {
  server.close((error) => {
    if (error) {
      console.error(error)
      process.exitCode = 1
    }
  })
}

process.on('SIGINT', close)
process.on('SIGTERM', close)
