import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('latest Figma glyph assets keep transparent canvases', async () => {
  const [css, lock, heart, moveSwipe, moveSave, moveFeed, moveProfile] = await Promise.all([
    read('public/figma-landing-v2.css'),
    read('public/figma/assets/lock.svg'),
    read('public/figma/assets/heart.svg'),
    read('public/figma/assets/move-swipe.svg'),
    read('public/figma/assets/move-save.svg'),
    read('public/figma/assets/move-feed.svg'),
    read('public/figma/assets/move-profile.svg'),
  ])

  for (const [name, svg] of Object.entries({ lock, heart, moveSwipe, moveSave, moveFeed, moveProfile })) {
    assert.match(svg, /fill="none"/, `${name} must keep a transparent SVG canvas`)
    assert.doesNotMatch(svg, /<rect[^>]+fill="(?:white|#fff|#ffffff)"/i, `${name} must not add a white matte`)
  }

  assert.match(moveSwipe, /stroke="#F2C035"/)
  assert.match(moveSave, /stroke="#78E152"/)
  assert.match(moveFeed, /stroke="#B784E4"/)
  assert.match(moveProfile, /stroke="#4CA5F7"/)
  assert.match(css, /\.safety-heart\{content:url\('\/figma\/assets\/heart\.svg'\);background:transparent!important\}/)
  assert.match(css, /move-swipe\.svg/)
  assert.match(css, /move-save\.svg/)
  assert.match(css, /move-feed\.svg/)
  assert.match(css, /move-profile\.svg/)
})

test('current desktop Figma uses the sticky split, visible hero phone, and right-column feature stack', async () => {
  const [css, app] = await Promise.all([
    read('public/figma-landing-v2.css'),
    read('public/app.js'),
  ])

  assert.match(css, /\.landing-canvas--desktop\{height:7578px!important;/)
  assert.match(css, /\.landing-sticky-left\{position:fixed;top:0;/)
  assert.match(css, /\.hero-phone-composite--desktop\{display:block!important;/)
  assert.doesNotMatch(css, /\.hero-phone-composite--mobile\{display:none/)
  assert.match(css, /\.feature-card--d-swipe\{left:668\.618px!important;top:1630\.039px!important;/)
  assert.match(css, /\.feature-card--d-save\{left:677\.382px!important;top:2562\.948px!important;/)
  assert.match(css, /\.feature-card--d-feed\{left:679\.33px!important;top:3494\.883px!important;/)
  assert.match(css, /\.feature-card--d-profile,\.profile-backdrop--desktop\{display:none!important\}/)
  assert.match(css, /\.discovery--desktop \.city-photo-wrap,\.discovery--desktop \.glass-strips--desktop,\.discovery--desktop \.discovery-fade\{display:none!important\}/)
  assert.doesNotMatch(css, /city-exact\.png[^}]*repeat-y/, 'desktop must not repeat an obsolete city crop')

  assert.match(app, /const DESKTOP_HEIGHT = 7578/)
  assert.match(app, /const DESKTOP_LEFT_WIDTH = 615/)
  assert.match(app, /function ensureDesktopStickyPane\(\)/)
  assert.match(app, /for \(const selector of \['\.hero-photo--left', '\.brand--desktop', '\.login-panel'\]\)/)
  assert.match(app, /pane\.style\.left = `\$\{stageRect\.left\}px`/)
  assert.match(app, /pane\.style\.width = `\$\{DESKTOP_LEFT_WIDTH \* scale\}px`/)
})
