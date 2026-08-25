import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Vercel compute is pinned beside the Supabase us-west-2 database', async () => {
  const vercel = JSON.parse(await read('vercel.json'))
  assert.deepEqual(vercel.regions, ['pdx1'])
  assert.doesNotMatch(await read('app/api/internal/b2-production-selftest/route.js'), /preferredRegion/)
})

test('Proxy verifies claims and only loads moderation profile state when required', async () => {
  const [proxy, session] = await Promise.all([
    read('proxy.js'),
    read('lib/supabase/proxy.js')
  ])
  assert.match(proxy, /loadProfileState: moderationGate/)
  assert.match(proxy, /Server-Timing|appendServerTiming/)
  assert.match(session, /supabase\.auth\.getClaims\(\)/)
  assert.doesNotMatch(session, /supabase\.auth\.getUser\(\)/)
  assert.match(session, /if \(!loadProfileState\)/)
})

test('Hot read APIs reuse verified claims instead of making a second auth-user request', async () => {
  const [discovery, map] = await Promise.all([
    read('app/api/discovery/route.js'),
    read('app/api/map/viewport/route.js')
  ])
  for (const source of [discovery, map]) {
    assert.match(source, /auth\.getClaims\(\)/)
    assert.doesNotMatch(source, /auth\.getUser\(\)/)
  }
})

test('Hot API routes own the account-state gate when proxy moderation is skipped', async () => {
  const [proxy, discovery, map] = await Promise.all([
    read('proxy.js'),
    read('app/api/discovery/route.js'),
    read('app/api/map/viewport/route.js')
  ])
  assert.match(proxy, /moderationExemptApiPaths = new Set\(\['\/api\/discovery', '\/api\/map\/viewport'\]\)/)
  for (const source of [discovery, map]) {
    assert.match(source, /suspended_at,banned_at/)
    assert.match(source, /Account status could not be verified/)
    assert.match(source, /This account is suspended|This account is banned/)
  }
})

test('Dashboard shell uses one trusted bootstrap RPC', async () => {
  const [shell, migration] = await Promise.all([
    read('components/product-shell.js'),
    read('supabase/migrations/10060_latency_optimization.sql')
  ])
  assert.match(shell, /rpc\('dashboard_bootstrap_v1'\)/)
  assert.doesNotMatch(shell, /known_privileged:/)
  assert.doesNotMatch(migration, /known_privileged/)
  // The bootstrap RPC is the single source; failures propagate.
  assert.doesNotMatch(shell, /Promise\.all\(/)
  assert.doesNotMatch(shell, /parallel_fallback/)
  assert.match(shell, /dashboard_bootstrap/)
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

test('Social feed avoids the missing feed-key RPC and restores indexed per-post comment previews', async () => {
  const [feed, restore] = await Promise.all([
    read('lib/app/social-feed-data.js'),
    read('supabase/migrations/20260825024000_restore_social_feed_hot_path.sql')
  ])
  assert.match(feed, /\.from\('social_posts'\)[\s\S]*\.select\('id,created_at'\)/)
  assert.match(feed, /\.order\('created_at', \{ ascending: false \}\)[\s\S]*\.order\('id', \{ ascending: false \}\)/)
  assert.match(feed, /social_feed_post_keys/)
  assert.doesNotMatch(feed, /rpc\('social_feed_post_ids_v2'/)
  assert.match(feed, /rpc\('social_comment_previews_v2'/)
  assert.match(feed, /social_comment_previews_fallback/)
  assert.match(restore, /social_posts_feed_keyset_idx/)
  assert.match(restore, /social_comments_post_preview_idx/)
  assert.match(restore, /create or replace function public\.social_comment_previews_v2/)
  assert.match(restore, /cross join lateral/)
  assert.match(restore, /security invoker/i)
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
  assert.match(cache, /const \[overlay, similarPlaces\] = await Promise\.all\(/)
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
