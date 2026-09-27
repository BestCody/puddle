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
