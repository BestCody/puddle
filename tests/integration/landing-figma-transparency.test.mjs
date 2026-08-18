import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('latest Figma glyph assets keep transparent canvases', async () => {
  const [css, html, lock, heart, moveSwipe, moveSave, moveFeed, moveProfile] = await Promise.all([
    read('public/landing.css'),
    read('public/landing.html'),
    read('public/figma/assets/lock.svg'),
    read('public/figma/assets/heart.svg'),
    read('public/figma/assets/move-swipe.svg'),
    read('public/figma/assets/move-save.svg'),
    read('public/figma/assets/move-feed.svg'),
    read('public/figma/assets/move-profile.svg')
  ])

  for (const [name, svg] of Object.entries({ lock, heart, moveSwipe, moveSave, moveFeed, moveProfile })) {
    assert.match(svg, /fill="none"/, `${name} must keep a transparent SVG canvas`)
    assert.doesNotMatch(svg, /<rect[^>]+fill="(?:white|#fff|#ffffff)"/i, `${name} must not add a white matte`)
  }

  assert.match(moveSwipe, /stroke="#F2C035"/)
  assert.match(moveSave, /stroke="#78E152"/)
  assert.match(moveFeed, /stroke="#B784E4"/)
  assert.match(moveProfile, /stroke="#4CA5F7"/)
  assert.match(html, /class="safety-heart" src="\/figma\/assets\/heart\.svg"/)
  assert.match(html, /src="\/figma\/assets\/move-swipe\.svg"/)
  assert.match(html, /src="\/figma\/assets\/move-save\.svg"/)
  assert.match(html, /src="\/figma\/assets\/move-feed\.svg"/)
  assert.match(html, /src="\/figma\/assets\/move-profile\.svg"/)
  assert.match(css, /\.safety-heart\s*\{[^}]*width:\s*97px;[^}]*height:\s*97px;/s)
})

test('current desktop Figma uses a CSS Grid sticky split and a normal-flow right-column feature stack', async () => {
  const [css, html, app] = await Promise.all([
    read('public/landing.css'),
    read('public/landing.html'),
    read('public/app.js')
  ])

  assert.match(html, /data-figma-node="83:76"/)
  assert.match(html, /class="landing-sticky-left"/)
  assert.match(html, /class="landing-canvas landing-canvas--desktop"/)
  assert.match(html, /feature-card--d-swipe/)
  assert.match(html, /feature-card--d-save/)
  assert.match(html, /feature-card--d-feed/)
  assert.doesNotMatch(html, /feature-card--d-profile/)
  assert.match(html, /class="hero-phone-composite hero-phone-composite--desktop"/)

  assert.match(css, /\.landing-stage--desktop\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:/s)
  assert.match(css, /\.landing-sticky-left\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s)
  assert.match(css, /\.landing-canvas\s*\{[^}]*position:\s*relative!important;[^}]*height:\s*auto!important;[^}]*transform:\s*none!important;/s)
  assert.match(css, /\.landing-canvas--desktop\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s)
  assert.match(css, /\.feature-card\s*\{[^}]*position:\s*relative;[^}]*margin:\s*0 auto 60px;/s)
  assert.match(css, /\.feature-card--d-profile,\.profile-backdrop--desktop\s*\{\s*display:\s*none\s*\}/)
  assert.doesNotMatch(css, /\.feature-card--d-swipe\s*\{[^}]*left:/s, 'Swipe page placement must not use a Figma x coordinate')
  assert.doesNotMatch(css, /\.feature-card--d-save\s*\{[^}]*top:/s, 'Save page placement must not use a Figma y coordinate')
  assert.doesNotMatch(css, /\.feature-card--d-feed\s*\{[^}]*top:/s, 'Feed page placement must not use a Figma y coordinate')
  assert.doesNotMatch(css, /scale\(/, 'landing must not whole-canvas scale')

  assert.doesNotMatch(app, /DESKTOP_HEIGHT/)
  assert.doesNotMatch(app, /DESKTOP_LEFT_WIDTH/)
  assert.doesNotMatch(app, /fitLanding/)
  assert.doesNotMatch(app, /ensureDesktopStickyPane/)
  assert.doesNotMatch(app, /canvas\.style\.transform/)
})
