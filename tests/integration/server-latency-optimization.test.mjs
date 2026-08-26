import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Vercel compute is pinned beside the Supabase us-west-2 database', async () => {
  const vercel = JSON.parse(await read('vercel.json'))
  assert.deepEqual(vercel.regions, ['pdx1'])
  assert.equal(vercel.fluid, true)
  assert.doesNotMatch(await read('app/api/internal/b2-production-selftest/route.js'), /preferredRegion/)
})

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
  const [discovery, map, snapshot, profile] = await Promise.all([
    read('app/api/discovery/route.js'),
    read('app/api/map/viewport/route.js'),
    read('app/api/map/snapshot/route.js'),
    read('lib/auth/profile.js')
  ])
  for (const source of [discovery, map]) {
    assert.match(source, /x-puddle-verified-user-id/)
    assert.doesNotMatch(source, /auth\.getClaims\(\)/)
    assert.doesNotMatch(source, /auth\.getUser\(\)/)
  }
  assert.match(discovery, /DISCOVERY_PROFILE_SELECT = 'latitude,longitude,search_radius_km,interests,location_label,city,suspended_at,banned_at'/)
  assert.doesNotMatch(discovery, /ensureProfile/)
  assert.match(map, /select\('suspended_at,banned_at'\)/)
  assert.doesNotMatch(map, /ensureProfile/)
  assert.match(snapshot, /getCurrentUser/)
  assert.match(snapshot, /getLocationMapSnapshot/)
  assert.doesNotMatch(profile, /profileLoads|PROFILE_CACHE_TTL_MS|invalidateProfileCache/)
})

test('Discovery overlaps profile and seen-history reads before B2 serving', async () => {
  const source = await read('app/api/discovery/route.js')
  assert.match(source, /const profilePromise = supabase[\s\S]*const seenPromise = \(async \(\) => \{[\s\S]*supabase\.rpc\('discovery_seen_locations_v1'\)/)
  assert.match(source, /Promise\.all\(\[profilePromise, seenPromise\]\)/)
  assert.match(source, /preloadedSeenLocationIds/)
})

test('Hot API routes own the account-state gate when proxy moderation is skipped', async () => {
  const [proxy, discovery, map, snapshot] = await Promise.all([
    read('proxy.js'),
    read('app/api/discovery/route.js'),
    read('app/api/map/viewport/route.js'),
    read('app/api/map/snapshot/route.js')
  ])
  assert.match(proxy, /moderationExemptApiPaths = new Set\(\['\/api\/discovery', '\/api\/map\/viewport', '\/api\/map\/snapshot', '\/api\/social-feed'\]\)/)
  assert.match(proxy, /verifiedReadApiPaths = new Set\(\['\/api\/discovery', '\/api\/map\/viewport', '\/api\/map\/snapshot', '\/api\/social-feed'\]\)/)
  for (const source of [discovery, map]) {
    assert.match(source, /profile\?\.suspended_at/)
    assert.match(source, /Account status could not be verified/)
    assert.match(source, /This account is suspended|This account is banned/)
  }
  assert.match(snapshot, /current\.profile\.suspended_at/)
  assert.match(snapshot, /Account status could not be verified/)
  assert.match(snapshot, /This account is suspended|This account is banned/)
})

test('Public catalogue reads share short-lived immutable search results across users', async () => {
  const [discovery, map] = await Promise.all([
    read('lib/app/discovery-global.js'),
    read('app/api/map/viewport/route.js')
  ])
  for (const source of [discovery, map]) {
    assert.match(source, /unstable_cache/)
    assert.match(source, /revalidate: 30/)
    assert.match(source, /tags: \['global-location-search'\]/)
  }
})

test('Hot cached routes load the B2 search graph only when catalogue data is needed', async () => {
  const sources = await Promise.all([
    read('lib/app/discovery-global.js'),
    read('app/api/map/viewport/route.js'),
    read('lib/app/social-feed-data.js'),
    read('lib/app/location-plans-data.js'),
    read('lib/app/public-location-cache.js'),
    read('lib/app/public-content.js'),
    read('lib/app/location-map-data.js')
  ])
  for (const source of sources) {
    assert.match(source, /await import\(['"][^'"]*global-location-search(?:\.js)?['"]\)/)
    assert.doesNotMatch(source, /import \{[^}]+\} from ['"][^'"]*global-location-search(?:\.js)?['"]/)
  }
})

test('Dashboard shell defers its one trusted bootstrap RPC until after critical HTML', async () => {
  const [shell, runtime, migration] = await Promise.all([
    read('components/product-shell.js'),
    read('components/dashboard-runtime.js'),
    read('supabase/migrations/10060_latency_optimization.sql')
  ])
  assert.match(shell, /<DashboardRuntime profileId=\{user\.id\} \/>/)
  assert.doesNotMatch(shell, /rpc\('dashboard_bootstrap_v1'\)/)
  assert.match(runtime, /rpc\('dashboard_bootstrap_v1'\)/)
  assert.doesNotMatch(runtime, /known_privileged:/)
  assert.doesNotMatch(migration, /known_privileged/)
  assert.doesNotMatch(runtime, /Promise\.all\(/)
  assert.doesNotMatch(runtime, /parallel_fallback/)
})

test('Map feed uses a lightweight protected shell and hydrates only through bounded APIs', async () => {
  const [layout, page, shell] = await Promise.all([
    read('app/(map)/layout.js'),
    read('app/(map)/map/page.js'),
    read('components/static-product-shell.js')
  ])
  assert.match(layout, /StaticProductShell/)
  assert.match(layout, /force-dynamic/)
  assert.match(page, /MapRouteClient/)
  assert.doesNotMatch(page, /requireUser|createClient|getSocialFeedSnapshot|location-map-data/)
  assert.match(shell, /FigmaDashboardSidebar/)
  assert.match(shell, /SettingsOverlay/)
  assert.match(shell, /form action=\{signOut\}/)
})

test('Latency migration adds bootstrap RPC, friendship indexes, and RLS init-plan fixes', async () => {
  const migration = await read('supabase/migrations/10060_latency_optimization.sql')
  assert.match(migration, /dashboard_bootstrap_v1/)
  assert.match(migration, /security invoker/i)
  assert.match(migration, /friendships_requester_idx/)
  assert.match(migration, /friendships_addressee_idx/)
  assert.match(migration, /\(select auth\.uid\(\)\)/)
  assert.doesNotMatch(migration, /security definer/i)
})

test('Social feed uses one indexed post-page read and a shell-first API render', async () => {
  const [feed, page, client, api, restore] = await Promise.all([
    read('lib/app/social-feed-data.js'),
    read('components/map-route-client.js'),
    read('components/social-feed-client.js'),
    read('app/api/social-feed/route.js'),
    read('supabase/migrations/20260825024000_restore_social_feed_hot_path.sql')
  ])
  assert.match(feed, /\.from\('social_posts'\)[\s\S]*profiles!social_posts_author_id_fkey/)
  assert.match(feed, /\.order\('created_at', \{ ascending: false \}\)[\s\S]*\.order\('id', \{ ascending: false \}\)/)
  assert.match(feed, /social_feed_posts/)
  assert.doesNotMatch(feed, /social_feed_post_keys/)
  assert.match(feed, /const \[locationResult, commentResult, statesResult\] = await Promise\.all\(/)
  assert.match(feed, /rpc\('social_comment_previews_v2'/)
  assert.match(feed, /const socialFeedInFlight = new Map\(\)/)
  assert.match(feed, /social-feed-location-hydration-v2/)
  assert.match(feed, /cachedSocialLocation\(id\)/)
  assert.doesNotMatch(feed, /queryOr|return new Map\(\)/)
  assert.match(feed, /revalidate: 300/)
  assert.doesNotMatch(feed, /social_comment_previews_fallback/)
  assert.match(page, /<SocialFeedClient/)
  assert.match(page, /useSearchParams/)
  assert.match(client, /fetch\(`\/api\/social-feed/)
  assert.match(client, /More puddles/)
  assert.match(api, /getSocialFeedSnapshot/)
  assert.match(api, /getCurrentUser/)
  assert.match(api, /Cache-Control.*private, no-store/)
  assert.doesNotMatch(page, /CreatePuddleSlot\(\{ feedPromise, mapPromise/)
  assert.match(restore, /social_posts_feed_keyset_idx/)
  assert.match(restore, /social_comments_post_preview_idx/)
  assert.match(restore, /create or replace function public\.social_comment_previews_v2/)
  assert.match(restore, /cross join lateral/)
  assert.match(restore, /security invoker/i)
})

test('B2 radius serving uses compact cores and a snapshot-aware entity cache', async () => {
  const [search, shards, runtimeCache, projection, gateway] = await Promise.all([
    read('lib/app/b2-location-search.js'),
    read('lib/app/location-search-shards.js'),
    read('lib/app/b2-runtime-object-cache.js'),
    read('lib/app/b2-text-search-projection.js'),
    read('lib/app/global-location-search.js')
  ])
  assert.match(search, /projection = await fetchTextProjectionCore\(targetPlan/)
  assert.match(search, /query\.normalized[\s\S]*scoreNormalizedTextFields/)
  assert.match(shards, /readB2RuntimeLocationCache\(prefix, values/)
  assert.match(shards, /queueB2RuntimeLocationCacheWrite\(prefix, loaded/)
  assert.match(runtimeCache, /LOCATION_CACHE_VERSION/)
  assert.match(runtimeCache, /b2RuntimeLocationCacheKey/)
  assert.match(shards, /manifestInFlight/)
  assert.match(projection, /READY_IN_FLIGHT/)
  assert.match(projection, /PROJECTION_PAYLOAD_IN_FLIGHT/)
  assert.match(gateway, /const searchInFlight = new Map\(\)/)
  assert.match(gateway, /const idsInFlight = new Map\(\)/)
})

test('Partial caching is limited to cookie-free published public location data', async () => {
  const [config, cache, publicClient, place, discover] = await Promise.all([
    read('next.config.mjs'),
    read('lib/app/public-location-cache.js'),
    read('lib/supabase/public.js'),
    read('app/places/[slug]/page.js'),
    read('app/(product)/discover/page.js')
  ])
  assert.doesNotMatch(config, /cacheComponents:\s*true/)
  assert.match(cache, /unstable_cache/)
  assert.match(cache, /revalidate:\s*300/)
  assert.match(cache, /tags:\s*\['public-locations'\]/)
  assert.match(cache, /return \{ location, similar: \[\] \}/)
  assert.match(cache, /cachedPublicLocationRecommendations/)
  assert.match(cache, /const publicLocationInFlight = new Map\(\)/)
  assert.doesNotMatch(cache, /cookies\(|headers\(/)
  assert.match(publicClient, /persistSession: false/)
  assert.match(place, /getCachedPublicLocation/)
  assert.doesNotMatch(place, /force-dynamic/)
  assert.match(discover, /dynamic = 'force-dynamic'/)
})

test('Swipe uses only optimized canonical first-party media', async () => {
  const [card, config, preloader] = await Promise.all([
    read('components/figma-swipe-card.js'),
    read('next.config.mjs'),
    read('components/discovery-photo-preloader.js')
  ])
  assert.match(card, /import Image from 'next\/image'/)
  assert.match(card, /<Image src=\{optimizedMainPhoto\}/)
  assert.match(card, /preload/)
  assert.doesNotMatch(card, /GoogleServerPlacePhoto|GooglePlacePhotoFallback|google_photo_proxy_url|google_client_lookup/)
  assert.match(card, /figma-swipe-card-photo-empty/)
  assert.match(config, /NEXT_PUBLIC_SUPABASE_URL/)
  assert.match(config, /\/storage\/v1\/object\/\*\*/)
  assert.doesNotMatch(config, /cegoqtvajwajczbofpep\.supabase\.co/)
  assert.match(preloader, /getImageProps/)
  assert.match(preloader, /image\.srcset = source\.srcSet/)
})

test('Discovery coalesces concurrent seen-history reads per authenticated user', async () => {
  const discovery = await read('lib/app/discovery-global.js')
  assert.match(discovery, /const seenLocationInFlight = new Map\(\)/)
  assert.match(discovery, /seenLocationInFlight\.get\(userId\)/)
  assert.match(discovery, /seenLocationInFlight\.set\(userId, request\)/)
  assert.match(discovery, /seenLocationInFlight\.delete\(userId\)/)
  assert.match(discovery, /Promise\.all\(\[seenPromise, searchPromise\]\)/)
  assert.match(discovery, /const refill = await searchGlobalLocations/)
})

test('Server latency budgets emit structured metrics without user identifiers', async () => {
  const metrics = await read('lib/performance/server-latency.js')
  assert.match(metrics, /SERVER_LATENCY_BUDGET_MS/)
  assert.match(metrics, /puddle_server_latency/)
  assert.match(metrics, /VERCEL_REGION/)
  assert.match(metrics, /over_budget/)
  assert.doesNotMatch(metrics, /userId|email|profileId/)
})
