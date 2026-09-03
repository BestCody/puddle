import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const settingsSections = [
  ['profile', 'Profile'],
  ['security', 'Email / Password'],
  ['appearance', 'Appearance'],
  ['notifications', 'Notifications'],
  ['sessions', 'Sessions'],
  ['billing', 'Billing'],
  ['account', 'Account']
]

test('mobile Settings links target their matching shared section routes', async () => {
  const page = await read('app/account/page.js')

  for (const [section, label] of settingsSections) {
    assert.match(page, new RegExp(`SettingsNavLink section="${section}" label="${label}"`))
    assert.match(page, new RegExp(`SettingsNavLink section="${section}"[\\s\\S]*?href=\\{settingsHref\\('${section}', returnTo, \\{ embedded, mobile: mobileFlow \\}\\)\\}`))
  }

  assert.match(page, /params\.set\('section', section\)/)
  assert.match(page, /const selectedSection = settingsSections\.has\(params\?\.section\) \? params\.section/)
  assert.match(page, /mobileFlow \? <Link className="figma-settings-mobile-back"/)
})

test('desktop continuous-form visibility rules do not override mobile section selection', async () => {
  const css = await read('app/ui-interaction-polish-fixes.css')

  for (const [section] of settingsSections) {
    assert.match(css, new RegExp(`\\.figma-settings-window:not\\(\\.is-mobile-flow-window\\) #${section}`))
    assert.doesNotMatch(css, new RegExp(`\\.figma-settings-window #${section}`))
  }
})
