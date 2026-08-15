import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('latest Figma landing keeps transparent component glyphs transparent', async () => {
  const [css, lock, heart, moveSwipe, moveSave, moveFeed, moveProfile] = await Promise.all([
    read('public/figma-landing-v2.css'),
    read('public/figma/assets/lock.svg'),
    read('public/figma/assets/heart.svg'),
    read('public/figma/assets/move.svg'),
    read('public/figma/assets/move-save.svg'),
    read('public/figma/assets/move-feed.svg'),
    read('public/figma/assets/move-profile.svg'),
  ])

  assert.match(css, /\.trust-heading img\{content:url\('\/figma\/assets\/lock\.svg'\);background:transparent!important\}/)
  assert.match(css, /\.safety-heart\{content:url\('\/figma\/assets\/heart\.svg'\);background:transparent!important\}/)
  assert.match(css, /move-save\.svg/)
  assert.match(css, /move-feed\.svg/)
  assert.match(css, /move-profile\.svg/)

  for (const [name, svg] of Object.entries({ lock, heart, moveSwipe, moveSave, moveFeed, moveProfile })) {
    assert.match(svg, /fill="none"/, `${name} must keep a transparent SVG canvas`)
    assert.doesNotMatch(svg, /<rect[^>]+fill="(?:white|#fff|#ffffff)"/i, `${name} must not add a white matte`)
  }

  assert.match(moveSwipe, /stroke="#F2C035"/)
  assert.match(moveSave, /stroke="#78E152"/)
  assert.match(moveFeed, /stroke="#B784E4"/)
  assert.match(moveProfile, /stroke="#4CA5F7"/)
})

test('latest desktop Figma masks Profile intentionally and hides only the desktop hero phone', async () => {
  const css = await read('public/figma-landing-v2.css')
  assert.match(css, /\.hero-phone-composite--desktop\{display:none!important\}/)
  assert.doesNotMatch(css, /\.hero-phone-composite--mobile\{display:none/)
  assert.match(css, /\.trust-heading--desktop::before\{[^}]*left:298px;top:4526px;width:685px;height:988px;/)
  assert.match(css, /background-position:0 17px,1px 84px,197px 0,179px 933px/)
  assert.match(css, /background-size:685px 76px,190px 904px,488px 988px,385px 55px/)
})
