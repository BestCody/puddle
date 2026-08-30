import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('landing feature phones map to the correct interactive Figma product screens', async () => {
  const [landingHtml, demoPage, demoComponent, demoCss, landingCss] = await Promise.all([
    read('public/landing.html'),
    read('app/landing-demo/[view]/page.js'),
    read('components/landing-phone-demo.js'),
    read('app/landing-phone-demo.css'),
    read('public/landing.css')
  ])

  // Figma 83:76 has Swipe/Save/Feed on desktop; Figma 161:116 adds Profile on mobile.
  for (const view of ['swipe', 'save', 'feed']) {
    assert.equal((landingHtml.match(new RegExp(`src="/landing-demo/${view}"`, 'g')) || []).length, 2, `${view} must be embedded once in desktop and once in mobile`)
  }
  assert.equal((landingHtml.match(/src="\/landing-demo\/profile"/g) || []).length, 1, 'Profile demo must appear only in the mobile Figma composition')
  assert.doesNotMatch(landingHtml, /feature-card--d-profile/)
  assert.match(landingHtml, /feature-card--m-profile/)

  for (const screenshot of ['phone-swipe.png', 'phone-save.png', 'phone-feed.png', 'phone-profile.png']) assert(!landingHtml.includes(screenshot), `${screenshot} must not be rendered as a feature-phone screenshot`)
  assert.match(landingHtml, /hero-phone-centered\.(png|webp)/, 'hero phone must use the normalized centered asset')
  assert.doesNotMatch(landingHtml, /hero-phone-device\.(png|webp)/, 'intermediate cropped hero asset must not remain in the landing page')
  assert.match(demoPage, /export const dynamic = 'force-dynamic'/, 'landing demos must render per request so Next can attach the CSP nonce and hydrate interactions')
  assert.doesNotMatch(demoPage, /export const dynamic = 'force-static'/)

  // The miniature screens must carry the identifying content from their authoritative Figma app frames.
  // Swipe 12:11 / 40:641.
  assert.match(demoComponent, /data-demo-screen="swipe"/)
  assert.match(demoComponent, /Maple Grove Park/)
  assert.match(demoComponent, /2243 Devon Road, Oakville/)
  assert.match(demoComponent, /208m/)
  assert.match(demoComponent, /aria-label="Pass place"/)
  assert.match(demoComponent, /aria-label="Save place"/)
  assert.match(demoComponent, /aria-label="Star place"/)
  assert.match(demoComponent, /aria-label=\{`Open \$\{current\.title\}`\}/)
  assert.match(demoComponent, /onClick=\{\(\) => setOpen\(true\)\}/)

  // Saved 25:180.
  assert.match(demoComponent, /data-demo-screen="save"/)
  assert.match(demoComponent, /Firehall Cool Bar Hot Grill/)
  assert.match(demoComponent, /Courts/)
  assert.match(demoComponent, /Theatres/)
  assert.match(demoComponent, /Search a saved puddle\.\.\./)

  // Feed 14:114.
  assert.match(demoComponent, /data-demo-screen="feed"/)
  assert.match(demoComponent, /Richie Zheng/)
  assert.match(demoComponent, /This place is amazing! The atmosphere is beautiful/)
  assert.match(demoComponent, /Create a puddle\.\.\./)
  assert.match(demoComponent, /Feed or map/)

  // Profile 40:347.
  assert.match(demoComponent, /data-demo-screen="profile"/)
  assert.match(demoComponent, /@Richiezh77/)
  assert.match(demoComponent, /345 Followers/)
  assert.match(demoComponent, /230 Following/)
  assert.match(demoComponent, /🍻Bar/)
  assert.match(demoComponent, /🌙Nightlife/)
  assert.match(demoComponent, /🛍️Shop/)
  for (const heading of ['Puddles', 'Location', 'Saves', 'Friends']) assert(demoComponent.includes(`>${heading}<`), `Profile must contain ${heading}`)

  // Static source checks prove the demos are wired for interaction; Playwright covers behavior in-browser.
  for (const stateSetter of ['setIndex', 'setTab', 'setCategory', 'setQuery', 'setView', 'setEditing', 'setFollowing', 'setMessageOpen']) assert(demoComponent.includes(stateSetter), `${stateSetter} interaction state must exist`)
  assert.match(demoComponent, /function DemoBottomNav\(\{ active, onNavigate \}\)/)
  assert.match(demoComponent, /className="landing-phone-demo__screen"/)
  assert.match(demoComponent, /onClick=\{\(\) => onNavigate\(view\)\}/)
  assert.doesNotMatch(demoComponent, /<a key=\{view\}/, 'Phone navigation must not perform frame document navigation')
  assert.match(demoComponent, /useModalFocus/)
  assert.match(demoComponent, /key === 'Escape'/)
  assert.match(demoComponent, /landing-demo-dialog" role="dialog" aria-modal="true" aria-label=\{`\$\{title\} details`\} tabIndex=\{-1\}/)
  assert.match(demoComponent, /onPointerMove=\{pointerMove\}/)
  assert.match(demoCss, /landing-demo-screen--swipe/)
  assert.match(demoCss, /landing-demo-screen--saved/)
  assert.match(demoCss, /landing-demo-screen--feed/)
  assert.match(demoCss, /landing-demo-screen--profile/)
  assert.match(demoCss, /\.landing-phone-demo\s*\{[^}]*container-type:inline-size;[^}]*padding:4\.5cqi;/s)
  assert.match(demoCss, /\.landing-phone-demo::before\s*\{[^}]*left:50%;[^}]*width:28cqi;/s)
  assert.match(demoCss, /\.landing-phone-demo__screen\s*\{[^}]*width:100%;[^}]*height:100%;[^}]*overflow:hidden;/s)
  assert.match(landingCss, /\.feature-phone-demo__frame\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*border:\s*0;/s)
  assert.match(landingCss, /\.interactive-pill\s*\{/)
  assert.match(landingCss, /\.interactive-pill\s*\{[^}]*pointer-events:\s*none;/s, 'the informational interactive pill must not block iframe controls')
})

test('product shell fixes keep compact menu bars and icon-only narrow sidebar', async () => {
  const [sidebar, polish, profile] = await Promise.all([
    read('components/resizable-product-sidebar.js'),
    read('app/product-polish.css'),
    read('app/(product)/profile/page.js')
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
