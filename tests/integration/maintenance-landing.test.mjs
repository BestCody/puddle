import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('maintenance entry is isolated from the preserved marketing landing', async () => {
  const [html, css, config, proxy, legacyLanding] = await Promise.all([
    read('public/maintenance.html'),
    read('public/maintenance.css'),
    read('next.config.mjs'),
    read('proxy.js'),
    read('public/landing.html')
  ])

  assert.match(config, /source: '\/', destination: '\/maintenance\.html'/)
  assert.match(proxy, /'\/maintenance\.html'/)
  assert.doesNotMatch(proxy, /shouldResolveLandingSession/)
  assert.doesNotMatch(proxy, /pathname === '\/' && user/)
  assert.match(legacyLanding, /class="landing"/)

  assert.match(html, /Alpha closed/)
  assert.match(html, /1\.0 coming soon/)
  assert.match(html, /href="https:\/\/www\.instagram\.com\/puddle\.you\/"/)
  assert.match(html, /hero-right\.webp/)
  assert.match(css, /min-block-size:\s*100dvh/)
  assert.match(css, /clamp\(/)
  assert.doesNotMatch(css, /\b\d+(?:\.\d+)?px\b/)
})
