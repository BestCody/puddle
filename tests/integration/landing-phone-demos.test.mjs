import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('landing feature phones are real public product demos, not screenshot placeholders', async () => {
  const [landingHtml, demoPage, demoComponent, demoCss, landingCss] = await Promise.all([
    read('public/landing.html'),
    read('app/landing-demo/[view]/page.js'),
    read('components/landing-phone-demo.js'),
    read('app/landing-phone-demo.css'),
    read('public/figma-landing-v2.css')
  ])

  for (const view of ['swipe', 'save', 'feed', 'profile']) {
    assert.equal((landingHtml.match(new RegExp(`src="/landing-demo/${view}"`, 'g')) || []).length, 2, `${view} must be embedded once in desktop and once in mobile`)
  }
  for (const screenshot of ['phone-swipe.png', 'phone-save.png', 'phone-feed.png', 'phone-profile.png']) assert(!landingHtml.includes(screenshot), `${screenshot} must not be rendered as a feature-phone screenshot`)
  assert.match(demoPage, /generateStaticParams/)
  assert.match(demoComponent, /MinimalSwipeCard/)
  assert.match(demoComponent, /MinimalSwipePreviewCard/)
  assert.match(demoComponent, /SwipeActionDock/)
  assert.match(demoComponent, /figma-saved-page/)
  assert.match(demoComponent, /figma-feed-page/)
  assert.match(demoComponent, /minimal-profile-page/)
  assert.match(demoCss, /landing-phone-demo--swipe/)
  assert.match(landingCss, /feature-phone-demo__frame/)
})

test('product shell fixes keep compact menu bars and icon-only narrow sidebar', async () => {
  const [sidebar, polish, profile] = await Promise.all([
    read('components/resizable-product-sidebar.js'),
    read('app/product-polish.css'),
    read('app/profile/page.js')
  ])

  assert.match(sidebar, /LABEL_MIN_WIDTH = 196/)
  assert.match(sidebar, /is-collapsed/)
  assert.match(polish, /\.minimal-product-sidebar:not\(\.is-expanded\).*\.product-nav-label\{display:none!important\}/s)
  assert.match(polish, /cursor:col-resize/)
  assert.match(polish, /\.figma-menu-icon\{display:flex!important;flex-direction:column/)
  assert.doesNotMatch(profile, /minimal-advanced-settings/)
  assert.doesNotMatch(profile, />Advanced</)
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
