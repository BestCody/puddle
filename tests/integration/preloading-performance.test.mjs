import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Discover keeps a bounded rolling preload window and refills before the deck runs dry', async () => {
  const [workspace, preloader] = await Promise.all([
    read('components/date-swipe-workspace-v2.js'),
    read('components/discovery-photo-preloader.js')
  ])

  assert.match(workspace, /const DECK_BATCH_SIZE = 12/)
  assert.match(workspace, /const REFILL_THRESHOLD = 5/)
  assert.match(workspace, /const PHOTO_PRELOAD_AHEAD = 2/)
  assert.match(workspace, /Math\.max\(0, feed\.items\.length - index\) <= REFILL_THRESHOLD/)
  assert.match(workspace, /<DiscoveryPhotoPreloader items=\{feed\.items\} index=\{index\} ahead=\{PHOTO_PRELOAD_AHEAD\} \/>/)

  assert.match(preloader, /item\.photo_urls/)
  assert.match(preloader, /item\.photo_url/)
  assert.match(preloader, /item\.cover_url/)
  assert.match(preloader, /item\.category_placeholder_url/)
  assert.doesNotMatch(preloader, /google_photo_proxy_url|google_client_lookup/)
  assert.match(preloader, /connection\?\.saveData/)
  assert.match(preloader, /effectiveType === 'slow-2g' \|\| effectiveType === '2g'/)
  assert.match(preloader, /image\.fetchPriority = 'low'/)
})

test('dashboard navigation prefetches only after user intent', async () => {
  const nav = await read('components/product-nav.js')

  assert.match(nav, /usePathname, useRouter/)
  assert.match(nav, /prefetch=\{false\}/)
  assert.match(nav, /router\.prefetch\(href/)
  assert.match(nav, /onMouseEnter=\{\(\) => warmRoute\(item\.href\)\}/)
  assert.match(nav, /onFocus=\{\(\) => warmRoute\(item\.href\)\}/)
  assert.match(nav, /onPointerDown=\{\(\) => warmRoute\(item\.href\)\}/)
  assert.match(nav, /prefetchedRoutes\.has\(href\)/)
})

test('all primary dashboard destinations expose route-specific loading skeletons', async () => {
  const variants = ['discover', 'map', 'plans', 'matches', 'membership', 'profile']
  const [component, styles, layout, ...loaders] = await Promise.all([
    read('components/product-route-loading.js'),
    read('app/performance-loading.css'),
    read('app/layout.js'),
    ...variants.map((variant) => read(`app/${variant}/loading.js`))
  ])

  assert.match(layout, /import '\.\/performance-loading\.css'/)
  assert.match(component, /product-route-loading-shell/)
  assert.match(styles, /\.product-route-loading-discover/)
  assert.match(styles, /\.product-route-loading-map/)
  assert.match(styles, /\.product-route-loading-list/)
  assert.match(styles, /\.product-route-loading-membership/)
  assert.match(styles, /\.product-route-loading-profile/)

  variants.forEach((variant, index) => {
    assert.match(loaders[index], new RegExp(`variant=\\"${variant}\\"`))
  })
})
