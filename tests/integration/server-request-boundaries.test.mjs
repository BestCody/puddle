import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Proxy verifies claims and only loads moderation profile state when required', async () => {
  const [proxy, session, pageUser] = await Promise.all([
    read('proxy.js'),
    read('lib/supabase/proxy.js'),
    read('lib/auth/user.js')
  ])
  assert.match(proxy, /loadProfileState: moderationGate/)
  assert.match(proxy, /Server-Timing|appendServerTiming/)
  assert.match(session, /supabase\.auth\.getClaims\(\)/)
  assert.doesNotMatch(session, /supabase\.auth\.getUser\(\)/)
  assert.match(session, /if \(!loadProfileState\)/)
  assert.match(proxy, /requestHeaders\.delete\(verifiedProductUserHeader\)/)
  assert.match(proxy, /requestHeaders\.set\(verifiedProductUserHeader, user\.id\)/)
  assert.match(pageUser, /mode: 'proxy_claims'/)
  assert.match(pageUser, /import \{ ensureProfile, profileSelect \} from '\.\/profile'/)
})

test('Hot read APIs consume the proxy-verified user and verify only required profile state', async () => {
  const [discovery, map, snapshot] = await Promise.all([
    read('app/api/discovery/route.js'),
    read('app/api/map/viewport/route.js'),
    read('app/api/map/snapshot/route.js')
  ])
  for (const source of [discovery, map]) {
    assert.match(source, /x-puddle-verified-user-id/)
    assert.doesNotMatch(source, /auth\.getClaims\(\)/)
    assert.doesNotMatch(source, /auth\.getUser\(\)/)
  }
  assert.match(discovery, /supabase\.rpc\('discovery_session_v1'\)/)
  assert.match(discovery, /seen_location_ids/)
  assert.doesNotMatch(discovery, /ensureProfile/)
  assert.match(map, /select\('suspended_at,banned_at'\)/)
  assert.doesNotMatch(map, /ensureProfile/)
  assert.match(snapshot, /getCurrentUser/)
  assert.match(snapshot, /getLocationMapSnapshot/)
})

test('Hot API routes own the account-state gate when proxy moderation is skipped', async () => {
  const [proxy, discovery, map, snapshot, heatmap] = await Promise.all([
    read('proxy.js'),
    read('app/api/discovery/route.js'),
    read('app/api/map/viewport/route.js'),
    read('app/api/map/snapshot/route.js'),
    read('app/api/map/heatmap/route.js')
  ])
  assert.match(proxy, /verifiedReadApiPaths = new Set\(\['\/api\/discovery', '\/api\/map\/viewport', '\/api\/map\/snapshot', '\/api\/map\/heatmap', '\/api\/social-feed', '\/api\/profile\/identity'\]\)/)
  assert.match(proxy, /requiresModerationGate\(pathname\) \{[\s\S]*!verifiedReadApiPaths\.has\(pathname\)/)
  for (const source of [discovery, map]) {
    assert.match(source, /profile\?\.suspended_at/)
    assert.match(source, /Account status could not be verified/)
    assert.match(source, /This account is suspended|This account is banned/)
  }
  assert.match(snapshot, /current\.profile\.suspended_at/)
  assert.match(snapshot, /Account status could not be verified/)
  assert.match(snapshot, /This account is suspended|This account is banned/)
  assert.match(heatmap, /getCurrentUser\(\{ profileFields: MAP_PROFILE_SELECT \}\)/)
  assert.match(heatmap, /current\.profileError \|\| !current\.profile/)
  assert.match(heatmap, /current\.profile\.suspended_at \|\| current\.profile\.banned_at/)
  assert.doesNotMatch(heatmap, /auth\.getUser\(\)/)
})

test('Navigation identity checks account state in its route after one proxy claim verification', async () => {
  const [proxy, identity] = await Promise.all([
    read('proxy.js'),
    read('app/api/profile/identity/route.js')
  ])
  assert.match(proxy, /requestHeaders\.delete\(verifiedProductUserHeader\)/)
  assert.match(proxy, /requestHeaders\.set\(verifiedProductUserHeader, user\.id\)/)
  assert.match(proxy, /verifiedReadApiPaths = new Set\([^\n]*'\/api\/profile\/identity'/)
  assert.match(proxy, /requiresModerationGate\(pathname\) \{[\s\S]*!verifiedReadApiPaths\.has\(pathname\)/)
  assert.match(identity, /getCurrentUser\(\{ profileFields: IDENTITY_PROFILE_SELECT \}\)/)
  assert.match(identity, /current\.profileError \|\| !current\.profile/)
  assert.match(identity, /!current\.profile\.onboarding_completed_at/)
  assert.match(identity, /current\.profile\.suspended_at \|\| current\.profile\.banned_at/)
  assert.match(identity, /'Cache-Control': 'private, no-store'/)
})

test('Partial caching is limited to cookie-free published public location data', async () => {
  const [cache, publicClient] = await Promise.all([
    read('lib/app/public-location-cache.js'),
    read('lib/supabase/public.js')
  ])
  assert.doesNotMatch(cache, /cookies\(|headers\(/)
  assert.match(publicClient, /persistSession: false/)
})
