import { access, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFile(join(root, path), 'utf8')

const required = [
  'package.json','vercel.json','next.config.mjs','proxy.js','.env.example',
  'public/landing.html','public/styles.css','public/landing.css','public/app.js','public/puddle-mark.svg',
  'app/layout.js','app/(product)/layout.js','app/(product)/loading.js','app/(product)/discover/page.js','app/(product)/map/page.js','app/(product)/matches/page.js','app/(product)/profile/page.js','app/(product)/plans/page.js','app/(product)/plans/[slug]/page.js',
  'app/api/discovery/route.js','app/api/discovery/actions/route.js','app/api/social/share-location/route.js','app/api/open-photo/[sha256]/route.js','app/api/media/upload/route.js','app/api/map/viewport/route.js',
  'components/product-nav.js','components/date-swipe-workspace-v2.js','components/figma-swipe-card.js',
  'lib/app/discovery.js','lib/app/discovery-global.js','lib/app/discovery-filters.js','lib/app/global-location-search.js','lib/app/b2-location-search.js','lib/app/location-search-shards.js','lib/app/location-search-ranking.js','lib/app/b2-search-object-store.js','lib/app/global-location-reference.js',
  'lib/app/public-location-cache.js','lib/app/location-plans-data.js','lib/app/global-connections-data.js','lib/app/social-hub-data.js','lib/app/location-moderation-overlay.js','lib/storage/b2-native.js','lib/media/open-photo-url.js',
  'scripts/b2-upload-tree.mjs','scripts/global-data/mirror_overture.py','scripts/global-data/mirror_fsq_iceberg.py','scripts/global-data/stage_global_sources.py','scripts/global-data/resolve_global_entities.py','scripts/global-data/location_search_common.py','scripts/global-data/build_b2_search_index.py','scripts/global-data/validate_b2_search_index.py','scripts/global-data/build_wikimedia_candidates.py','scripts/global-data/build_mapillary_candidates.py','scripts/global-data/build_kartaview_candidates.py','scripts/global-data/materialize_photo_candidates.py',
  '.github/workflows/global-location-data.yml','.github/workflows/b2-location-search-smoke.yml','.github/workflows/global-photo-enrichment.yml','.github/workflows/global-kartaview-enrichment.yml',
  'supabase/migrations/20260818204500_lazy_location_refs_cutover.sql','supabase/migrations/20260818204600_location_relational_overlays.sql','supabase/migrations/20260818204700_opensearch_heatmap_and_actions.sql','supabase/migrations/20260818204800_remove_remaining_location_catalogue_coupling.sql',
  'scripts/check-security-surface.mjs','scripts/check-secrets.mjs','scripts/check-client-boundaries.mjs','scripts/check-duplicate-assets.mjs','scripts/check-bundle-size.mjs'
]
for (const path of required) await access(join(root, path))

const removed = [
  'lib/app/discovery-relational.js','lib/app/discovery-relational-fallback.js',
  'lib/app/catalogue-batch-writer.js','lib/app/catalogue-import-runner.js','lib/app/catalogue-quality.js','lib/app/catalogue-regions.js','lib/app/open-place-catalogue.js',
  'lib/app/approved-open-photo.js','lib/app/open-photo-candidates.js','lib/app/open-photo-b2.js','lib/app/open-photo-transform.js','lib/app/static-open-photo-provider.js','lib/app/photo-enrichment.js','lib/app/place-photos.js','lib/app/location-quality.js',
  'lib/app/google-place-client.js','lib/app/google-place-discovery.js','lib/app/google-place-match.js','lib/app/google-place-photo-proxy.js','lib/app/provider-request-limiter.js',
  'scripts/register-location-photos.mjs','scripts/enrich-open-location-photos.mjs','scripts/import-open-location-photos.mjs','scripts/match-google-places.mjs','scripts/discover-google-place-ids.mjs','scripts/repair-google-place-addresses.mjs','scripts/profile-discovery-spatial.mjs',
  'scripts/global-data/export-supabase-bootstrap.mjs','scripts/global-data/build-bootstrap-parquet.py','.github/workflows/global-bootstrap.yml',
  '.github/workflows/photo-enrichment.yml','.github/workflows/google-place-discovery.yml','.github/workflows/google-place-geocode.yml','.github/workflows/google-place-match.yml',
  'app/api/location-google-photo/[id]/route.js','app/api/location-open-photo/[id]/route.js','app/api/location-photo-status/[id]/route.js','app/api/location-photos/[id]/route.js',
  'app/api/static-catalogue','lib/app/static-catalogue.js','lib/app/static-catalogue-materialization.js','lib/app/static-media-resolver.js',
  'lib/app/open-photo-supabase.js','lib/app/open-photo-r2.js','lib/app/r2-s3.js'
]
for (const path of removed) {
  try {
    await access(join(root, path))
    throw new Error(`Legacy location path is still present: ${path}`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

const syntaxFiles = [
  'next.config.mjs','proxy.js','instrumentation.js','lib/app/discovery.js','lib/app/discovery-global.js','lib/app/discovery-filters.js','lib/app/global-location-search.js','lib/app/b2-location-search.js','lib/app/location-search-shards.js','lib/app/location-search-ranking.js','lib/app/b2-search-object-store.js','lib/app/global-location-reference.js','lib/app/location-moderation-overlay.js','lib/app/public-location-cache.js','lib/app/location-plans-data.js','lib/app/global-connections-data.js','lib/app/social-hub-data.js','lib/storage/b2-native.js','lib/media/open-photo-url.js',
  'scripts/check.mjs','scripts/check-security-surface.mjs','scripts/check-secrets.mjs','scripts/check-client-boundaries.mjs','scripts/check-duplicate-assets.mjs','scripts/check-bundle-size.mjs','scripts/b2-upload-tree.mjs',
  'public/app.js','app/api/discovery/route.js','app/api/discovery/actions/route.js','app/api/social/share-location/route.js','app/api/open-photo/[sha256]/route.js','app/api/media/upload/route.js','app/api/map/viewport/route.js'
]
for (const path of syntaxFiles) execFileSync(process.execPath, ['--check', join(root, path)], { stdio: 'pipe' })

const pkg = JSON.parse(await read('package.json'))
for (const dependency of ['@supabase/ssr','@supabase/supabase-js','next','react','react-dom','sharp']) {
  if (!pkg.dependencies?.[dependency]) throw new Error(`Missing dependency: ${dependency}`)
}
const serializedScripts = JSON.stringify(pkg.scripts || {})
for (const forbidden of ['static-catalogue','global:bootstrap:export','locations:photos','locations:google','locations:spatial']) {
  if (serializedScripts.includes(forbidden)) throw new Error(`Legacy catalogue command remains: ${forbidden}`)
}
for (const requiredScript of ['b2:upload-tree','global:overture:mirror','global:fsq:mirror','global:index','global:index:validate','global:photos:wikimedia','global:photos:mapillary','global:photos:kartaview','global:photos:materialize']) {
  if (!pkg.scripts?.[requiredScript]) throw new Error(`Global B2 command is missing: ${requiredScript}`)
}

const env = await read('.env.example')
for (const forbidden of ['STATIC_CATALOGUE_','STATIC_MEDIA_RESOLUTION_ENABLED','PUDDLE_LEGACY_SYSTEMS_ENABLED','R2_PUBLIC_BASE_URL','R2_CONFIG','OPEN_PHOTO_SUPABASE_BUCKET','GLOBAL_LOCATION_FALLBACK_TO_SUPABASE','GLOBAL_LOCATION_EMERGENCY_RELATIONAL_FALLBACK','GLOBAL_LOCATION_SEARCH_BACKEND=','OPENSEARCH_USERNAME','OPENSEARCH_PASSWORD','OPENSEARCH_BEARER_TOKEN','GLOBAL_LOCATION_SEARCH_URL']) {
  if (env.includes(forbidden)) throw new Error(`Legacy environment setting remains: ${forbidden}`)
}
for (const requiredEnv of ['GLOBAL_LOCATION_SEARCH_MANIFEST_KEY','B2_DATA_APPLICATION_KEY_ID','B2_DATA_APPLICATION_KEY','B2_MEDIA_APPLICATION_KEY_ID','B2_MEDIA_APPLICATION_KEY','FSQ_ICEBERG_TOKEN','MAPILLARY_ACCESS_TOKEN']) {
  if (!env.includes(requiredEnv)) throw new Error(`Environment example is missing ${requiredEnv}`)
}

const discoverySelector = await read('lib/app/discovery.js')
if (!discoverySelector.includes('getGlobalDiscoveryFeed')) throw new Error('Discovery must use the global location-search feed')
for (const forbidden of ['getRelationalDiscoveryFeed','discovery-relational','GLOBAL_LOCATION_SEARCH_ENABLED']) {
  if (discoverySelector.includes(forbidden)) throw new Error(`Discovery still contains a legacy serving selector: ${forbidden}`)
}
for (const marker of ['suspendedLocationIds','location-moderation-overlay']) {
  if (!discoverySelector.includes(marker)) throw new Error(`Discovery moderation overlay is missing ${marker}`)
}

const globalDiscovery = await read('lib/app/discovery-global.js')
for (const marker of ['global-location-serving','searchGlobalLocations','global-location-v1']) {
  if (!globalDiscovery.includes(marker)) throw new Error(`Global discovery is missing ${marker}`)
}
const globalSearch = await read('lib/app/global-location-search.js')
for (const marker of ['searchB2GlobalLocations','searchB2GlobalLocationsInViewport','getB2GlobalLocationBySlug','getB2GlobalLocationsByIds']) {
  if (globalSearch.includes('opensearch')) throw new Error('Global location-search facade still references retired OpenSearch')
  if (!globalSearch.includes(marker)) throw new Error(`Global location-search facade is missing ${marker}`)
}
const b2Search = await read('lib/app/b2-location-search.js')
for (const marker of ['resolveGeoShardPlan','haversineDistanceMeters','matchesStructuredFilters','scoreTextMatch','createTopK']) {
  if (!b2Search.includes(marker)) throw new Error(`B2 location search is missing ${marker}`)
}
if (b2Search.includes('primary_photo.url') || globalSearch.includes('primary_photo.url')) throw new Error('Global search restored URL-coupled photo storage')
const shardRouter = await read('lib/app/location-search-shards.js')
for (const marker of ['GLOBAL_LOCATION_MAX_SHARDS','GLOBAL_LOCATION_MAX_COMPRESSED_BYTES','GLOBAL_LOCATION_MAX_CANDIDATES','directoryTilesForBounds','getLocationsByIdsFromShards','getLocationBySlugFromShards']) {
  if (!shardRouter.includes(marker)) throw new Error(`B2 shard router is missing ${marker}`)
}

const refs = await read('lib/app/global-location-reference.js')
for (const marker of ["from('location_refs')",'getGlobalLocationsByIds',"kind: 'global'"]) {
  if (!refs.includes(marker)) throw new Error(`Lazy global reference path is missing ${marker}`)
}
for (const forbidden of ["from('locations')",'source_metadata','latitude:','longitude:']) {
  if (refs.includes(forbidden)) throw new Error(`Lazy reference path still copies catalogue metadata: ${forbidden}`)
}

const publicLocation = await read('lib/app/public-location-cache.js')
for (const marker of ['getGlobalLocationBySlug','searchGlobalLocations',"from('location_host_links')",'isLocationSuspended']) {
  if (!publicLocation.includes(marker)) throw new Error(`Public location path is missing ${marker}`)
}
if (publicLocation.includes("from('locations')")) throw new Error('Public location path still reads the Supabase catalogue')

const actions = await read('app/api/discovery/actions/route.js')
for (const marker of ['record_discovery_actions_v4','ensureGlobalLocationReferences','adjust_location_save_density_batch_v1']) {
  if (!actions.includes(marker)) throw new Error(`Discovery action path is missing ${marker}`)
}

const openPhoto = await read('app/api/open-photo/[sha256]/route.js')
for (const marker of ['canonicalStorageKey','media/photos/by-sha256/','actualHash !== hash']) {
  if (!openPhoto.includes(marker)) throw new Error(`B2 photo delivery is missing ${marker}`)
}
if (openPhoto.includes("from('media_objects')")) throw new Error('Canonical B2 photo delivery still depends on Supabase media registration')

const createActions = await read('app/(product)/create/actions.js')
if (!createActions.includes("from('location_submissions')")) throw new Error('Place authoring is not isolated to location_submissions')
if (createActions.includes("from('locations')")) throw new Error('Place authoring still writes the global catalogue table')

const cutover = await read('supabase/migrations/20260818204500_lazy_location_refs_cutover.sql')
for (const marker of ['create table if not exists public.location_refs','create table if not exists public.location_submissions','drop table public.locations','record_discovery_actions_v4_unchecked','references public.location_refs']) {
  if (!cutover.includes(marker)) throw new Error(`Location cutover migration is missing ${marker}`)
}
const overlays = await read('supabase/migrations/20260818204600_location_relational_overlays.sql')
for (const marker of ['public.location_host_links','public.location_submissions','public.location_refs','approve_location_claim','can_view_media_asset']) {
  if (!overlays.includes(marker)) throw new Error(`Relational overlay migration is missing ${marker}`)
}
const heatmap = await read('supabase/migrations/20260818204700_opensearch_heatmap_and_actions.sql')
for (const marker of ['adjust_location_save_density_batch_v1','location_save_density_tiles','densityDelta','drop function if exists public.record_discovery_actions_v3']) {
  if (!heatmap.includes(marker)) throw new Error(`Historical action/heatmap migration is missing ${marker}`)
}
const finalCleanup = await read('supabase/migrations/20260818204800_remove_remaining_location_catalogue_coupling.sql')
for (const marker of ['location_moderation_overrides','public.location_host_links','public.location_submissions','drop function if exists public.recommendation_candidate_pool_v1','delete from public.content_embeddings where content_kind=\'place\'']) {
  if (!finalCleanup.includes(marker)) throw new Error(`Final catalogue cleanup migration is missing ${marker}`)
}

// Exhaustively fence the application runtime against direct Supabase catalogue reads.
// Git is the source of truth for exact tracked paths; historical migrations are excluded.
const runtimeFiles = execFileSync('git', ['ls-files', '-z', 'app', 'components', 'lib'], { cwd: root })
  .toString()
  .split('\0')
  .filter((path) => path && /\.(?:[cm]?js|jsx|ts|tsx)$/.test(path))
for (const relative of runtimeFiles) {
  const source = await read(relative)
  for (const pattern of [
    /\.from\(\s*['"]locations['"]\s*\)/,
    /\.from\(\s*['"]location_photo_sources['"]\s*\)/,
    /\.from\(\s*['"]location_google_places['"]\s*\)/,
    /\bdiscovery-relational\b/,
    /\/api\/location-(?:google-photo|open-photo|photo-status|photos)\//
  ]) {
    if (pattern.test(source)) throw new Error(`Runtime restored retired location catalogue coupling in ${relative}: ${pattern}`)
  }
}

console.log(`Architecture checks passed: B2 sharded global catalogue with lazy Supabase location refs across ${runtimeFiles.length} runtime files.`)
