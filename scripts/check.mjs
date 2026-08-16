import { access, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFile(join(root, path), 'utf8')

const required = [
  'package.json','vercel.json','next.config.mjs','proxy.js','.env.example',
  'public/landing.html','public/styles.css','public/landing-responsive.css','public/landing-hardening.css','public/app.js','public/puddle-mark.svg',
  'app/layout.js','app/discover/page.js','app/map/page.js','app/map/MapFeed.module.css','app/matches/page.js','app/profile/page.js','app/plans/page.js','app/plans/Plans.module.css','app/plans/[slug]/page.js','app/membership/page.js','app/account/page.js','app/create/post/page.js',
  'app/figma-dashboard-rebuild.css','app/figma-dashboard-create-post.css','app/figma-dashboard-friends.css','app/figma-dashboard-pass.css','app/figma-dashboard-profile.css','app/figma-dashboard-profile-customize.css','app/figma-dashboard-settings.css',
  'app/api/discovery/route.js','app/api/discovery/actions/route.js','app/api/social/share-location/route.js','app/api/media/upload/route.js',
  'components/product-nav.js','components/product-shell.js','components/date-swipe-workspace-v2.js','components/figma-swipe-card.js','components/swipe-action-dock.js','components/figma-social-hub.js','components/profile-photo-editor.js',
  'lib/app/discovery-relational.js','lib/app/discovery-filters.js','lib/app/social-hub-data.js','lib/app/open-photo-supabase.js','lib/media/pipeline.js',
  'scripts/check-security-surface.mjs','scripts/check-secrets.mjs','scripts/check-client-boundaries.mjs','scripts/check-duplicate-assets.mjs','scripts/check-bundle-size.mjs',
  'supabase/migrations/10046_friends_messages_social_hub.sql','supabase/migrations/10050_relational_discovery_runtime.sql','supabase/seed.sql'
]
for (const path of required) await access(join(root, path))

const removed = [
  '.vercel-redeploy','action-schema-audit.txt','dependency-audit.txt','legacy-audit.txt','cutover-output.txt','landing-demo.js','requirements.txt',
  'app/date-match','app/hangout','app/api/date-match','app/api/static-catalogue','app/api/storage/b2-access','app/date-match.css',
  'app/figma-dashboard-feed.css','app/figma-dashboard-feed-fidelity.css','app/figma-dashboard-saved.css','app/figma-dashboard-saved-detail-fidelity.css',
  'components/date-match-workspace.js','components/date-match-workspace-realtime.js',
  'lib/app/date-match.js','lib/app/date-match-rules.js','lib/app/date-match-snapshot.js',
  'lib/app/discovery-infrastructure.js','lib/app/discovery-infrastructure-v2.js','lib/app/discovery-relational-fallback.js',
  'lib/app/static-catalogue.js','lib/app/static-catalogue-materialization.js','lib/app/static-media-resolver.js','lib/app/use-private-b2-asset.js','lib/app/use-static-catalogue-details.js','lib/app/use-static-media-resolution.js',
  'lib/app/open-photo-r2.js','lib/app/r2-s3.js',
  '.github/workflows/b2-cleanup.yml','.github/workflows/static-catalogue-b2.yml','.github/workflows/ops-static-discovery-probe.yml',
  '.github/workflows/ops-live-photo-open-import.yml','.github/workflows/ops-live-photo-google-match.yml'
]
for (const path of removed) {
  try {
    await access(join(root, path))
    throw new Error(`Removed legacy path is still present: ${path}`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

const syntaxFiles = [
  'next.config.mjs','proxy.js','lib/app/discovery-relational.js','lib/app/discovery-filters.js','lib/app/social-hub-data.js','lib/media/pipeline.js',
  'scripts/check.mjs','scripts/check-security-surface.mjs','scripts/check-secrets.mjs','scripts/check-client-boundaries.mjs','scripts/check-duplicate-assets.mjs','scripts/check-bundle-size.mjs','scripts/import-open-location-photos.mjs',
  'public/app.js','app/api/discovery/route.js','app/api/discovery/actions/route.js','app/api/social/share-location/route.js','app/api/media/upload/route.js'
]
for (const path of syntaxFiles) execFileSync(process.execPath, ['--check', join(root, path)], { stdio: 'pipe' })

const pkg = JSON.parse(await read('package.json'))
for (const dependency of ['@supabase/ssr','@supabase/supabase-js','next','react','react-dom','sharp']) {
  if (!pkg.dependencies?.[dependency]) throw new Error(`Missing dependency: ${dependency}`)
}
const serializedScripts = JSON.stringify(pkg.scripts || {})
for (const forbidden of ['b2:','catalogue:build-static','catalogue:publish-b2','static-catalogue','cleanup-b2-assets','cleanup-r2-assets']) {
  if (serializedScripts.includes(forbidden)) throw new Error(`Legacy package command remains: ${forbidden}`)
}

const env = await read('.env.example')
for (const forbidden of ['B2_','STATIC_CATALOGUE_','STATIC_MEDIA_RESOLUTION_ENABLED','PUDDLE_LEGACY_SYSTEMS_ENABLED']) {
  if (env.includes(forbidden)) throw new Error(`Legacy environment setting remains: ${forbidden}`)
}
for (const requiredEnv of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_TINDER_PRICE_ID','GOOGLE_PLACES_API_KEY']) {
  if (!env.includes(requiredEnv)) throw new Error(`Environment example is missing ${requiredEnv}`)
}

const proxy = await read('proxy.js')
for (const route of ['/dashboard','/discover','/matches','/global-matches','/plans','/profile','/onboarding','/account','/admin']) {
  if (!proxy.includes(route)) throw new Error(`Proxy does not protect ${route}`)
}
for (const retired of ['/date-match','/hangout']) if (proxy.includes(`'${retired}'`)) throw new Error(`Proxy still references retired route ${retired}`)

const layout = await read('app/layout.js')
if (layout.includes("import './date-match.css'")) throw new Error('Retired shared swipe stylesheet is still imported')
for (const dashboardStyle of ['figma-dashboard-rebuild.css','figma-dashboard-friends.css','figma-dashboard-pass.css','figma-dashboard-profile.css','figma-dashboard-settings.css']) {
  if (!layout.includes(`import './${dashboardStyle}'`)) throw new Error(`Dashboard rebuild stylesheet is not loaded: ${dashboardStyle}`)
}
for (const retiredRouteStyle of ['figma-dashboard-feed.css','figma-dashboard-feed-fidelity.css','figma-dashboard-saved.css','figma-dashboard-saved-detail-fidelity.css']) {
  if (layout.includes(retiredRouteStyle)) throw new Error(`Migrated route must not load retired global stylesheet: ${retiredRouteStyle}`)
}
const feedPage = await read('app/map/page.js')
if (!feedPage.includes("import styles from './MapFeed.module.css'")) throw new Error('Feed route is not using its scoped CSS Module')
if (!feedPage.includes('data-testid="feed-screen"')) throw new Error('Feed route is missing rendered visual-regression hooks')
const savedPage = await read('app/plans/page.js')
const savedDetailPage = await read('app/plans/[slug]/page.js')
for (const source of [savedPage, savedDetailPage]) if (!source.includes('Plans.module.css')) throw new Error('Saved routes are not using their scoped CSS Module')
if (!savedPage.includes('data-testid="saved-screen"') || !savedDetailPage.includes('data-testid="saved-detail-screen"')) throw new Error('Saved routes are missing rendered regression hooks')

const productNav = await read('components/product-nav.js')
for (const label of ['Swipe','Feed','Saved','Friends','Pass','Profile']) if (!productNav.includes(`label: '${label}'`)) throw new Error(`Navigation is missing ${label}`)

const discoverPage = await read('app/discover/page.js')
const discoveryRoute = await read('app/api/discovery/route.js')
const discovery = await read('lib/app/discovery-relational.js')
const actions = await read('app/api/discovery/actions/route.js')
const swipe = await read('components/date-swipe-workspace-v2.js')
const card = await read('components/figma-swipe-card.js')
for (const source of [discoverPage, discoveryRoute]) if (!source.includes("@/lib/app/discovery-relational")) throw new Error('Discover does not use the canonical relational feed')
for (const marker of ['r2_discovery_overlay_v1','discovery_seen_locations_v1','duplicateKey','supabase-relational-v2']) if (!discovery.includes(marker)) throw new Error(`Relational discovery is missing ${marker}`)
for (const forbidden of ['static-catalogue','STATIC_CATALOGUE','r2-primary','R2_CATALOGUE_NOT_CONFIGURED']) if (discovery.includes(forbidden)) throw new Error(`Legacy discovery runtime remains: ${forbidden}`)
for (const marker of ['record_discovery_actions_v4','MAX_ACTIONS = 20']) if (!actions.includes(marker)) throw new Error(`Discovery actions are missing ${marker}`)
for (const forbidden of ['materializeStaticCatalogueReferences','verifiedStaticReference','staticRef','staticEphemeral']) if (actions.includes(forbidden)) throw new Error(`Legacy static action support remains: ${forbidden}`)
for (const marker of ['FigmaSwipeCard','SwipeActionDock',"'/api/discovery/actions'",'excludeIds']) if (!swipe.includes(marker)) throw new Error(`Swipe workspace is missing ${marker}`)
for (const forbidden of ['MinimalSwipeCard','DiscoverSocialBar','InviteSheet','createSharedDeck','/api/date-match/start','staticCatalogueEphemeral','prefetchStaticMedia']) if (swipe.includes(forbidden)) throw new Error(`Retired swipe dependency remains: ${forbidden}`)
for (const marker of ['figma-swipe-card','GooglePlacePhotoFallback','Open details']) if (!card.includes(marker)) throw new Error(`Figma swipe card is missing ${marker}`)
for (const forbidden of ['usePrivateB2Asset','useStaticCatalogueDetails','useStaticMediaResolution','/api/static-catalogue/']) if (card.includes(forbidden)) throw new Error(`Legacy card dependency remains: ${forbidden}`)

const relationalRuntime = await read('supabase/migrations/10050_relational_discovery_runtime.sql')
for (const marker of ['discovery_seen_locations_v1','r2_discovery_overlay_v1','record_discovery_actions_v3','record_discovery_actions_v4_unchecked']) {
  if (!relationalRuntime.includes(marker)) throw new Error(`Relational discovery runtime is missing ${marker}`)
}
for (const forbidden of ['static_catalogue_actions','static_catalogue_materializations','staticEphemeral','touch_static_catalogue_materializations_v1']) {
  if (relationalRuntime.includes(forbidden)) throw new Error(`Legacy database runtime remains in final cutover migration: ${forbidden}`)
}

const openPhotoImporter = await read('scripts/import-open-location-photos.mjs')
if (!openPhotoImporter.includes("storeOpenPhotoInSupabase")) throw new Error('Open-photo importer does not use Supabase storage directly')
for (const forbidden of ['storeOpenPhotoInR2','open-photo-r2','r2-s3','R2_CONFIG','R2_PUBLIC_BASE_URL']) {
  if (openPhotoImporter.includes(forbidden)) throw new Error(`Legacy open-photo storage compatibility remains: ${forbidden}`)
}

const share = await read('app/api/social/share-location/route.js')
if (!share.includes('send_location_to_friend_v1')) throw new Error('Friend location sharing is missing')
for (const forbidden of ['materializeStaticCatalogueReferences','verifiedStaticReference','staticRef']) if (share.includes(forbidden)) throw new Error(`Legacy share support remains: ${forbidden}`)

const friendsPage = await read('app/matches/page.js')
const socialHub = await read('components/figma-social-hub.js')
const profile = await read('app/profile/page.js')
for (const marker of ['FigmaSocialHub','getSocialHubSnapshot']) if (!friendsPage.includes(marker)) throw new Error(`Friends page is missing ${marker}`)
for (const marker of ['Message','Shared','Add','social_friend_search_v1','social_send_message_v1']) if (!socialHub.includes(marker)) throw new Error(`Figma social hub is missing ${marker}`)
if (!profile.includes('ProfilePhotoEditor')) throw new Error('Profile photo management is missing')
if (!profile.includes('customize=1')) throw new Error('Profile customization state is missing')

const socialMigration = await read('supabase/migrations/10046_friends_messages_social_hub.sql')
for (const marker of ['social_send_friend_request_v1','social_conversations_v1','friends_who_liked_location_v1','send_location_to_friend_v1','remove_profile_photo_v1']) {
  if (!socialMigration.includes(marker)) throw new Error(`Social migration is missing ${marker}`)
}

console.log(`Current-product repository check passed: ${required.length} required paths verified and legacy runtime paths absent.`)