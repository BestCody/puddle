import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Feed, map, and Saved detail load interactive map code only when needed', async () => {
  const [route, saved] = await Promise.all([
    read('components/map-route-client.js'),
    read('components/saved-location-morph-bridge.js')
  ])

  assert.match(route, /dynamic\(\(\) => import\('@\/components\/location-map'\)/)
  assert.match(route, /dynamic\(\(\) => import\('@\/components\/social-feed-client'\)/)
  assert.match(route, /void import\('@\/components\/location-map'\)/)
  assert.match(route, /view === 'map' \? <MapScreen[\s\S]*: <SocialFeedClient/)
  assert.doesNotMatch(route, /import \{ (?:LocationMap|SocialFeedClient) \} from/)

  assert.match(saved, /dynamic\(\(\) => import\('@\/components\/location-map'\)/)
  assert.match(saved, /detail && point\.length \? <LocationMap/)
  assert.doesNotMatch(saved, /import \{ LocationMap \} from/)
})

test('map catalogue and heatmap requests wait for a measured viewport', async () => {
  const map = await read('components/location-map.js')
  assert.match(map, /setViewportMeasured\(true\)/)
  assert.match(map, /viewportMeasured \? <MapTileLayer/)
  assert.match(map, /if \(!viewportMeasured\) return undefined/)
  assert.match(map, /if \(!passActive \|\| !heatmapEnabled \|\| !viewportMeasured\) return undefined/)
})

test('Profile queries only as many friends as it displays', async () => {
  const profile = await read('app/(product)/profile/page.js')
  assert.match(profile, /social_friends_v2', \{ before_name: null, before_id: null, result_limit: 4 \}/)
  assert.match(profile, /friends\.slice\(0, 4\)/)
  assert.match(profile, /readFriendCount\(session\.supabase\)/)
})

test('Settings scroll observation is mounted only on Settings', async () => {
  const [root, account] = await Promise.all([
    read('app/layout.js'),
    read('app/account/page.js')
  ])
  assert.doesNotMatch(root, /SettingsScrollBridge|settings-scroll-bridge/)
  assert.match(account, /import \{ SettingsScrollBridge \} from '@\/components\/settings-scroll-bridge'/)
  assert.match(account, /<SettingsScrollBridge \/>/)
})

test('Settings iframe and embedded dashboard work load only when opened', async () => {
  const [overlay, shell, account, plans] = await Promise.all([
    read('components/settings-overlay.js'),
    read('components/product-shell.js'),
    read('app/account/page.js'),
    read('app/(product)/plans/page.js')
  ])

  assert.match(overlay, /\{open \? <iframe[\s\S]*src="\/account\?embedded=1&returnTo=%2Fprofile"/)
  assert.match(overlay, /\{open && !frameLoaded \? <div[\s\S]*puddle-settings-overlay-loading-text[\s\S]*Loading settings/)
  assert.match(shell, /if \(embedded\) return[\s\S]*<AppearanceSync initialAppearance=\{appearance\} \/>[\s\S]*<MainContentTransition>\{content\}<\/MainContentTransition>/)
  assert.match(account, /<ProductShell[^>]*embedded=\{embedded\}/)
  assert.match(plans, /\{active === 'saved' \? <SavedLocationMorphBridge \/> : null\}/)
})

test('mobile Settings fetches full notification data only for its notification section', async () => {
  const account = await read('app/account/page.js')
  assert.match(account, /const showSection = \(section\) => !mobileFlow \|\| selectedSection === section/)
  assert.match(account, /const showNotifications = showSection\('notifications'\)/)
  assert.match(account, /if \(showNotifications\) \{[\s\S]*notification_preferences[\s\S]*puddle_tinder_active_v1/)
  assert.match(account, /else if \(!selectedSection\) \{[\s\S]*count: 'exact', head: true[\s\S]*\.is\('read_at', null\)/)
  assert.match(account, /\{showNotifications \? <section className="figma-settings-section" id="notifications">/)
  for (const section of ['profile', 'security', 'appearance', 'sessions', 'billing', 'account']) {
    assert.match(account, new RegExp(`\\{showSection\\('${section}'\\) \\? <(?:section|form) className="figma-settings-section" id="${section}"`))
  }
})
