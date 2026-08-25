import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Vercel compute is pinned beside the Supabase us-west-2 database', async () => {
  const vercel = JSON.parse(await read('vercel.json'))
  assert.deepEqual(vercel.regions, ['pdx1'])
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

test('Dashboard shell uses one trusted bootstrap RPC with parallel fallback', async () => {
  const [shell, migration] = await Promise.all([
    read('components/product-shell.js'),
    read('supabase/migrations/10060_latency_optimization.sql')
  ])
  assert.match(shell, /rpc\('dashboard_bootstrap_v1'\)/)
  assert.doesNotMatch(shell, /known_privileged:/)
  assert.doesNotMatch(migration, /known_privileged/)
  // Fallback removal: the bootstrap RPC is the single source; failures propagate.
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
  assert.doesNotMatch(cache, /cookies\(|headers\(/)
  assert.match(publicClient, /persistSession: false/)
  assert.match(place, /getCachedPublicLocation/)
  assert.doesNotMatch(place, /force-dynamic/)
  assert.match(discover, /dynamic = 'force-dynamic'/)
})

test('Swipe uses Next Image for optimized first-party media while Google fallback remains isolated', async () => {
  const [card, config, preloader] = await Promise.all([
    read('components/figma-swipe-card.js'),
    read('next.config.mjs'),
    read('components/discovery-photo-preloader.js')
  ])
  assert.match(card, /import Image from 'next\/image'/)
  assert.match(card, /<Image src=\{optimizedMainPhoto\}/)
  assert.match(card, /preload/)
  assert.match(card, /GoogleServerPlacePhoto/)
  assert.match(card, /GooglePlacePhotoFallback/)
  assert.match(config, /NEXT_PUBLIC_SUPABASE_URL/)
  assert.match(config, /\/storage\/v1\/object\/\*\*/)
  assert.doesNotMatch(config, /cegoqtvajwajczbofpep\.supabase\.co/)
  assert.match(preloader, /getImageProps/)
  assert.match(preloader, /image\.srcset = source\.srcSet/)
})

test('Server latency budgets emit structured metrics without user identifiers', async () => {
  const metrics = await read('lib/performance/server-latency.js')
  assert.match(metrics, /SERVER_LATENCY_BUDGET_MS/)
  assert.match(metrics, /puddle_server_latency/)
  assert.match(metrics, /VERCEL_REGION/)
  assert.match(metrics, /over_budget/)
  assert.doesNotMatch(metrics, /userId|email|profileId/)
})
