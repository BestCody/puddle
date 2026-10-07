import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

export function stagingCatalogueOrigin(env) {
  if (env.PUDDLE_STAGING_CONFIRM !== 'staging-only') throw new Error('Explicit staging-only confirmation is required')
  const url = new URL(env.PUDDLE_STAGING_APP_URL)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUDDLE_STAGING_APP_URL must be an HTTP loopback origin')
  }
  return url.origin
}

async function page(origin, path) {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(30_000) })
  assert.equal(response.status, 200, `${path} must return HTTP 200`)
  return response.text()
}

export async function runStagingCatalogueSmoke(env = process.env) {
  const origin = stagingCatalogueOrigin(env)
  const health = JSON.parse(await page(origin, '/api/health'))
  assert.equal(health.ok, true)
  assert.equal(health.locationSearchBackend, 'object-store')
  assert.match(String(health.buildSha || ''), /^staging-/)

  for (const path of ['/places/in/toronto', '/places/in/new-york', '/date-ideas/toronto']) {
    const html = await page(origin, path)
    const cards = [...html.matchAll(/class="place-hub-card"/g)].length
    assert.ok(cards > 0, `${path} returned 200 but has no real place cards; the catalogue is not ready`)
    assert.ok(!html.includes('place-hub-empty'), `${path} must not render an empty catalogue`)
    const detailPath = /href="(\/places\/(?!in\/)[^"?#]+)"/.exec(html)?.[1]
    assert.ok(detailPath, `${path} must link to a place detail page`)
    const detail = await page(origin, detailPath)
    assert.ok(detail.includes('<h1'), `${detailPath} must render a place heading`)
    process.stdout.write(`${path}: ${cards} real cards; a linked place detail passed.\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStagingCatalogueSmoke().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
