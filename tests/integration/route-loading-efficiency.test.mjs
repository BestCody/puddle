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
  assert.match(saved, /ready && nearViewport \? <LocationMap/)
  assert.match(saved, /<SavedInlineMap ready=\{Boolean\(detail\)\}/)
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

test('Saved recommendations load near the viewport and public place reads overlap', async () => {
  const [savedSimilar, placePage] = await Promise.all([
    read('app/(product)/plans/[slug]/similar-places.js'),
    read('app/places/[slug]/page.js')
  ])
  assert.match(savedSimilar, /new IntersectionObserver/)
  assert.match(savedSimilar, /rootMargin: '25%'/)
  assert.match(savedSimilar, /if \(!nearViewport\) return undefined[\s\S]*fetch\(`/)
  assert.match(placePage, /Promise\.all\(\[\s*getCachedPublicLocation\(slug\),\s*getCachedPublicLocationRecommendations\(slug\)/)
})

test('Friends loads only the active tab UI, and Profile defers photo controls until opened', async () => {
  const [friendsPage, friendsRoute, profilePage, avatarEditor] = await Promise.all([
    read('app/(product)/matches/page.js'),
    read('components/friends-route-content.js'),
    read('app/(product)/profile/page.js'),
    read('components/profile-avatar-editor.js')
  ])
  assert.doesNotMatch(friendsPage, /from '@\/components\/(?:figma-messages-realtime|figma-social-hub|pass-message-search)'/)
  for (const component of ['figma-messages-realtime', 'figma-social-hub', 'pass-message-search']) {
    assert.match(friendsRoute, new RegExp(`dynamic\\(\\(\\) => import\\('./${component}'\\)`))
  }
  assert.match(friendsRoute, /tab === 'add' && snapshot\.passActive \? <PassMessageSearch enabled \/>/)
  assert.match(friendsRoute, /tab === 'messages'[\s\S]*<FigmaMessagesRealtime/)
  assert.doesNotMatch(profilePage, /from '@\/components\/profile-photo-editor'/)
  assert.match(profilePage, /<ProfileAvatarEditor/)
  assert.match(avatarEditor, /if \(event\.currentTarget\.open\) setRequested\(true\)/)
  assert.match(avatarEditor, /\{requested \? <ProfilePhotoEditor/)
})

test('Profile overlaps place hydration with independent friend and count reads', async () => {
  const profilePage = await read('app/(product)/profile/page.js')
  assert.match(profilePage, /const globalRowsPromise = Promise\.all\(\[postRowsPromise, saveRowsPromise\]\)\.then/)
  assert.match(profilePage, /friendCountPromise, globalRowsPromise\s*\]/)
  assert.doesNotMatch(profilePage, /const globalRows = await globalLocations/)
})

test('Messages starts thread and place reads without waiting for the friend list', async () => {
  const socialHub = await read('lib/app/social-hub-data.js')
  assert.match(socialHub, /const threadPromise = conversationsPromise\.then/)
  assert.match(socialHub, /const locationsPromise = Promise\.all\(\[conversationsPromise, sharedRowsPromise, threadPromise\]\)/)
  assert.match(socialHub, /friendsPromise, conversationsPromise, sharedRowsPromise, passActivePromise, threadPromise, locationsPromise/)
})

test('map place hydration overlaps membership and Swipe-selected post skips the map snapshot', async () => {
  const [mapData, createPost, chooser] = await Promise.all([
    read('lib/app/location-map-data.js'),
    read('app/(product)/create/post/page.js'),
    read('app/(product)/create/post/post-place-chooser.js')
  ])
  assert.match(mapData, /const locationsPromise = plansPromise\.then/)
  assert.match(mapData, /Promise\.all\(\[plansPromise, passActivePromise, locationsPromise\]\)/)
  assert.match(createPost, /const snapshot = directPoint \? null : await getLocationMapSnapshot\(session\)/)
  assert.match(chooser, /if \(event\.currentTarget\.open\) void loadPlaces\(\)/)
  assert.match(chooser, /fetch\('\/api\/map\/snapshot'/)
})
