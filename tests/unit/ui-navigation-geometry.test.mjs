import test from 'node:test'
import assert from 'node:assert/strict'
import { mapPopupPosition } from '../../lib/ui/map-popup-position.js'
import { settingsActionDestination, settingsReturnPath } from '../../lib/app/settings-navigation.js'
import { normalizeProfileInterests } from '../../lib/app/profile-interests.js'
import { pathWithMessage } from '../../lib/auth/redirect.js'

test('map popup flips and stays contained while following visible markers', () => {
  const viewport = { width: 320, height: 500 }, popup = { width: 270, height: 100 }
  for (const anchor of [{ x: 3, y: 3 }, { x: 317, y: 3 }, { x: 3, y: 497 }, { x: 317, y: 497 }, { x: 160, y: 250 }]) {
    const result = mapPopupPosition({ anchor, viewport, popup, gap: 16, gutter: 8 })
    assert.ok(result.left >= 0 && result.top >= 0)
    assert.ok(result.left + popup.width <= viewport.width)
    assert.ok(result.top + popup.height <= viewport.height)
    assert.equal(result.left + result.tip, anchor.x)
    assert.equal(result.side, anchor.y < 116 ? 'below' : 'above')
  }
  assert.equal(mapPopupPosition({ anchor: { x: -1, y: 250 }, viewport, popup, gap: 16, gutter: 8 }), null)
  assert.equal(mapPopupPosition({ anchor: { x: 160, y: 501 }, viewport, popup, gap: 16, gutter: 8 }), null)
})

test('Settings form redirects preserve only the valid presentation context', () => {
  const form = new FormData()
  form.set('settings_return', '/account?mobile=1&returnTo=%2Fplans&section=account&error=old')
  let url = new URL(settingsActionDestination(form, 'appearance'), 'https://puddle.internal')
  assert.equal(url.searchParams.get('mobile'), '1')
  assert.equal(url.searchParams.get('section'), 'appearance')
  assert.equal(url.searchParams.get('returnTo'), '/plans')
  assert.equal(new URL(pathWithMessage(url.pathname + url.search, 'success', 'Saved'), 'https://puddle.internal').searchParams.get('mobile'), '1')
  assert.equal(url.searchParams.has('error'), false)
  form.set('settings_return', '/account?embedded=1&returnTo=https://evil.example')
  url = new URL(settingsActionDestination(form, 'profile'), 'https://puddle.internal')
  assert.equal(url.searchParams.get('embedded'), '1')
  assert.equal(url.searchParams.get('returnTo'), '/profile')
  for (const unsafe of ['https://evil.example', '//evil.example', '/other?mobile=1', '/account\\evil']) {
    form.set('settings_return', unsafe)
    url = new URL(settingsActionDestination(form, 'notifications'), 'https://puddle.internal')
    assert.equal(url.pathname, '/account')
    assert.equal(url.searchParams.has('mobile'), false)
  }
  assert.equal(settingsReturnPath('/plans?q=coffee'), '/plans?q=coffee')
  assert.equal(settingsReturnPath('/unknown'), '/profile')
})

test('profile and onboarding share canonical interest values without duplicates', () => {
  assert.deepEqual(normalizeProfileInterests(['park', 'cafe', 'park', 'unknown']), ['park', 'cafe'])
  assert.deepEqual(normalizeProfileInterests([]), [])
})
