import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('landing feature phones reuse production components with deterministic fixture data', async () => {
  const [landingHtml, demoPage, demoComponent, demoCss, landingCss, globalCss] = await Promise.all([
    read('public/landing.html'),
    read('app/landing-demo/[view]/page.js'),
    read('components/landing-phone-demo.js'),
    read('app/landing-phone-demo.css'),
    read('public/landing.css'),
    read('app/global.css')
  ])

  for (const view of ['swipe', 'save', 'feed']) {
    const sourceCount = (landingHtml.match(new RegExp('src="/landing-demo/' + view + '"', 'g')) || []).length
    assert.equal(sourceCount, 2, view + ' must be embedded once in desktop and once in mobile')
  }
  assert.equal((landingHtml.match(/src="\/landing-demo\/profile"/g) || []).length, 0)
  assert.doesNotMatch(landingHtml, /Popular cities/)
  assert.doesNotMatch(landingHtml, /feature-card--d-profile|feature-card--m-profile/)
  for (const screenshot of ['phone-swipe.png', 'phone-save.png', 'phone-feed.png']) assert(!landingHtml.includes(screenshot))
  assert.match(landingHtml, /hero-phone-centered\.(png|webp)/)
  assert.doesNotMatch(landingHtml, /hero-phone-device\.(png|webp)/)
  assert.match(demoPage, /export const dynamic = 'force-dynamic'/)
  assert.match(demoPage, /import '@\/app\/landing-phone-demo\.css'/)
  assert.doesNotMatch(globalCss, /landing-phone-demo\.css/)
  assert.doesNotMatch(demoPage, /export const dynamic = 'force-static'/)

  for (const component of ['FigmaSwipeCard', 'SwipeActionDock', 'SavedLightweightGrid', 'SocialFeedClient', 'RoutedSegment']) assert(demoComponent.includes(component), component + ' must be reused by the landing demos')
  assert.doesNotMatch(demoComponent, /feedStyles/)
  for (const contract of ['staticMode', 'initialPreviews={savedPreviewMap}', 'loadPreviews={false}', 'landingFeedClasses', 'detailsButtonLabel', 'onDemoPlaceOpen']) assert(demoComponent.includes(contract), contract + ' must be present')
  for (const screen of ['data-demo-screen="swipe"', 'data-demo-screen="save"', 'data-demo-screen="feed"']) assert(demoComponent.includes(screen), screen + ' must remain addressable')
  for (const place of ['Maple Grove Park', 'Firehall Cool Bar Hot Grill', 'Night Gallery', 'Film House']) assert(demoComponent.includes(place), place + ' must remain in the deterministic fixture set')
  for (const asset of ['safety-toronto', 'safety-new-york', 'safety-los-angeles', 'safety-san-francisco', 'collage-5']) {
    assert(demoComponent.includes('/figma/assets/' + asset + '.webp'))
    assert(demoComponent.includes('/figma/assets/' + asset + '.png'))
  }
  assert.doesNotMatch(demoComponent, /function (FeedPost|ProfileDemo|FriendsDemo|PassDemo)|landing-demo-feed-pictures/)
  assert.doesNotMatch(demoComponent, /friendPeople|friendRequests|passPerks|landing-demo-screen--(profile|friends|pass)/)
  assert.match(demoComponent, /function DemoImage/)
  assert.match(demoComponent, /data-figma-screen="40:641"/)
  assert.match(demoComponent, /data-figma-screen="25:180"/)
  assert.match(demoComponent, /data-figma-screen="40:519"/)
  for (const stateSetter of ['setIndex', 'setTab', 'setCategory', 'setQuery', 'setView']) assert(demoComponent.includes(stateSetter), stateSetter + ' interaction state must exist')
  assert.match(demoComponent, /function DemoBottomNav/)
  assert.match(demoComponent, /className="landing-phone-demo__screen"/)
  assert.match(demoComponent, /onClick/)
  assert.doesNotMatch(demoComponent, /<a key=\{view\}/)
  assert.match(demoComponent, /useModalFocus/)
  assert.match(demoComponent, /key === 'Escape'/)

  for (const marker of ['landing-demo-screen--swipe', 'landing-demo-screen--saved', 'landing-demo-screen--feed', 'landing-demo-swipe-stack', 'landing-demo-swipe-card', 'landing-demo-swipe-actions', 'landing-demo-feed-stream', 'landing-demo-saved-copy']) assert(demoCss.includes(marker), marker + ' must be styled')
  assert.match(demoCss, /html:has\(\.landing-phone-demo\)[\s\S]*body:has\(\.landing-phone-demo\)/)
  assert.match(demoCss, /\.landing-phone-demo__screen\s*\{/)
  assert.match(demoCss, /\.landing-demo-dialog-backdrop\s*\{/)
  assert.match(demoCss, /\.landing-demo-dialog\s*\{/)
  assert.doesNotMatch(demoCss, /(?:^|[,{\s])(?:figma-swipe|routed-segment|saved-lightweight)(?:[-.\s:{]|$)/m)
  assert.doesNotMatch(demoCss, /!important/)
  assert.doesNotMatch(demoCss, /landing-demo-feed-pictures/)
  assert.doesNotMatch(demoCss, /landing-demo-(profile|friends|pass)/)

  assert.match(landingCss, /\.feature-card/)
  assert.match(landingCss, /\.feature-phone/)
  assert.match(landingCss, /\.interactive-pill/)
})

test('product shell uses the current resizable sidebar and navigation', async () => {
  const [shell, sidebar, nav] = await Promise.all([
    read('components/static-product-shell.js'),
    read('components/figma-dashboard-sidebar.js'),
    read('components/product-nav.js')
  ])

  assert.match(shell, /<FigmaDashboardSidebar signOutAction=\{signOut\}/)
  assert.match(sidebar, /<ProductNav avatarUrl=\{avatarUrl\}/)
  assert.match(sidebar, /aria-label="Resize navigation sidebar"/)
  assert.match(sidebar, /onPointerDown=\{beginResize\}/)
  assert.match(sidebar, /onKeyDown=\{keyboardResize\}/)
  assert.match(nav, /className="figma-dashboard-nav"/)
  assert.match(nav, /figma-dashboard-nav-label/)
})

test('only landing demos can be framed by the same origin', async () => {
  const [headers, proxy, nextConfig] = await Promise.all([
    read('lib/security/headers.js'),
    read('proxy.js'),
    read('next.config.mjs')
  ])

  assert.match(headers, /allowSameOriginFrame/)
  assert.match(headers, /frame-src 'self'/)
  assert.match(headers, /allowSameOriginFrame \? "'self'" : "'none'"/)
  assert.match(headers, /SAMEORIGIN/)
  assert.match(proxy, /pathname\.startsWith\('\/landing-demo\/'\)/)
  assert.match(nextConfig, /\/landing-demo\/:path\*/)
  assert.match(nextConfig, /SAMEORIGIN/)
})
