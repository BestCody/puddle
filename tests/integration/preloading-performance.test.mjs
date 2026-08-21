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
  assert.match(preloader, /item\?\.category_placeholder_url/)
  assert.doesNotMatch(preloader, /google_photo_proxy_url|google_client_lookup/)
  assert.match(preloader, /connection\?\.saveData/)
  assert.match(preloader, /effectiveType === 'slow-2g' \|\| effectiveType === '2g'/)
  assert.match(preloader, /image\.fetchPriority = 'low'/)
  assert.match(preloader, /getImageProps/)
  assert.match(preloader, /DISCOVERY_IMAGE_SIZES/)
  assert.match(preloader, /image\.srcset = source\.srcSet/)
})

test('dashboard navigation warms routes efficiently and selects exactly one item immediately', async () => {
  const nav = await read('components/product-nav.js')

  assert.match(nav, /useEffect, useRef, useState/)
  assert.match(nav, /usePathname, useRouter/)
  assert.match(nav, /prefetch=\{false\}/)
  assert.match(nav, /router\.prefetch\(href/)
  assert.match(nav, /onMouseEnter=\{\(\) => warmRoute\(item\.href\)\}/)
  assert.match(nav, /onFocus=\{\(\) => warmRoute\(item\.href\)\}/)
  assert.match(nav, /connection\?\.saveData/)
  assert.match(nav, /const \[selectedHref, setSelectedHref\] = useState\(routeActiveHref\)/)
  assert.match(nav, /const navigationIntentRef = useRef\(null\)/)
  assert.match(nav, /function selectImmediately\(event, href\)[\s\S]*setSelectedHref\(href\)/)
  assert.match(nav, /onPointerDown=\{\(event\) => \{[\s\S]*selectImmediately\(event, item\.href\)/)
  assert.match(nav, /setSelectedHref\(href\)[\s\S]*beginMainContentLoading\(\)/)
  assert.match(nav, /const active = item\.href === selectedHref/)
  assert.doesNotMatch(nav, /pendingHref|setPendingHref/)
  assert.match(nav, /\{ href: '\/map', label: 'Discover'/)
  assert.doesNotMatch(nav, /label: 'Feed'|activeLabel: 'Explore'/)
})

test('top pills use Pass dimensions and move their highlight before navigation completes', async () => {
  const [segment, bridge, sidebarStyles, mapPage, plansPage, passPage, layout] = await Promise.all([
    read('components/instant-segment.js'),
    read('components/segment-interaction-bridge.js'),
    read('app/sidebar-interactions.css'),
    read('app/map/page.js'),
    read('app/plans/page.js'),
    read('app/membership/page.js'),
    read('app/layout.js')
  ])

  assert.match(segment, /const \[activeIndex, setActiveIndex\] = useState/)
  assert.match(segment, /onPointerDown=\{\(event\) =>/)
  assert.match(segment, /select\(index\)/)
  assert.match(segment, /--segment-active-index': activeIndex/)
  assert.match(segment, /figma-instant-segment-highlight/)

  assert.match(bridge, /document\.addEventListener\('pointerdown', onPointerDown, true\)/)
  assert.match(bridge, /segment\.style\.setProperty\('--segment-active-index'/)
  assert.match(bridge, /control\.classList\.toggle\('is-ui-active'/)
  assert.match(layout, /<SegmentInteractionBridge \/>/)

  assert.match(sidebarStyles, /width:\s*167px !important/)
  assert.match(sidebarStyles, /height:\s*48px !important/)
  assert.match(sidebarStyles, /padding:\s*4px !important/)
  assert.match(sidebarStyles, /border-radius:\s*999px !important/)
  assert.match(sidebarStyles, /place-items:\s*center !important/)
  assert.match(sidebarStyles, /transition:\s*transform 145ms/)
  assert.match(sidebarStyles, /translateX\(calc\(var\(--segment-active-index\) \* 100%\)\)/)

  assert.match(mapPage, /\{ value: 'feed', label: 'Feed', href: '\/map' \}/)
  assert.match(mapPage, /tone="yellow"/)
  assert.match(plansPage, /tone="purple"/)
  assert.match(passPage, /tone="pink"/)
})

test('dashboard navigation keeps the shell mounted and scopes loading to main content', async () => {
  const [transition, nav, shell, styles, sidebarStyles, layout] = await Promise.all([
    read('components/main-content-transition.js'),
    read('components/product-nav.js'),
    read('components/product-shell.js'),
    read('app/performance-loading.css'),
    read('app/sidebar-interactions.css'),
    read('app/layout.js')
  ])

  assert.match(layout, /import '\.\/performance-loading\.css'/)
  assert.match(layout, /import '\.\/sidebar-interactions\.css'/)
  assert.match(shell, /import \{ MainContentTransition \} from '\.\/main-content-transition'/)
  assert.match(shell, /<FigmaDashboardSidebar avatarUrl=\{avatarUrl\} \/>[\s\S]*<main className="figma-dashboard-main"><MainContentTransition>\{children\}<\/MainContentTransition><\/main>/)

  assert.match(transition, /export const MAIN_CONTENT_LOADING_EVENT = 'puddle:main-content-loading'/)
  assert.match(transition, /window\.dispatchEvent\(new Event\(MAIN_CONTENT_LOADING_EVENT\)\)/)
  assert.match(transition, /function startLoading\(\) \{\s*setLoading\(true\)\s*\}/)
  assert.match(transition, /setLoading\(false\)/)
  assert.doesNotMatch(transition, /SPINNER_DELAY_MS|setTimeout|useRef/)
  assert.match(transition, /puddle-main-transition-loader/)
  assert.match(transition, /puddle-main-spinner/)

  assert.match(nav, /beginMainContentLoading\(\)/)
  assert.match(nav, /onClick=\{\(event\) => startNavigation\(event, item\.href\)\}/)

  assert.match(sidebarStyles, /\.figma-dashboard-nav-item:not\(\.is-active\):hover/)
  assert.match(sidebarStyles, /background:\s*#d7d7d7/)
  assert.match(sidebarStyles, /border-color:\s*#c4c4c4/)
  assert.match(sidebarStyles, /color:\s*var\(--figma-grey\)/)
  assert.match(sidebarStyles, /\.figma-dashboard-nav-item\.is-active[\s\S]*filter:\s*brightness\(1\.08\)/)

  assert.match(styles, /\.puddle-main-transition\.is-loading \.puddle-main-transition-content/)
  assert.match(styles, /\.puddle-main-transition-loader/)
  assert.match(styles, /\.puddle-main-spinner/)
  assert.doesNotMatch(styles, /\.product-route-loading-/)
})
