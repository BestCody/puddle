import { access, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const required = [
  'package.json','vercel.json','next.config.mjs','proxy.js','.env.example',
  'public/landing.html','public/styles.css','public/landing-responsive.css','public/app.js','public/puddle-mark.svg',
  'app/layout.js','app/auth.css','app/onboarding.css','app/date-swipe.css','app/swipe-v2.css','app/date-match.css','app/real-place-photos.css','app/product.css','app/sidebar-refresh.css','app/minimal-product.css','app/group-map.css','app/loading.js','app/error.js',
  'app/signin/page.js','app/signup/page.js','app/forgot-password/page.js','app/update-password/page.js','app/auth/actions.js','app/auth/callback/route.js','app/auth/confirm/route.js','app/auth/error/page.js',
  'app/onboarding/page.js','app/onboarding/actions.js','app/dashboard/page.js','app/account/page.js','app/discover/page.js','app/date-match/[token]/page.js','app/hangout/[token]/page.js','app/matches/page.js','app/plans/page.js','app/profile/page.js','app/create/place/page.js',
  'app/api/auth/session/route.js','app/api/discovery/route.js','app/api/discovery/actions/route.js','app/api/date-match/start/route.js','app/api/date-match/action/route.js','app/api/date-match/[token]/route.js','app/api/media/upload/route.js','app/api/geocode/route.js',
  'components/auth-shell.js','components/product-shell.js','components/product-nav.js','components/puddle-logo.js','components/empty-state.js','components/date-swipe-workspace-v2.js','components/minimal-swipe-card.js','components/swipe-action-dock.js','components/date-match-workspace.js','components/service-worker-cleanup.js',
  'lib/supabase/client.js','lib/supabase/server.js','lib/supabase/proxy.js','lib/supabase/admin.js','lib/auth/user.js','lib/auth/redirect.js','lib/security/csrf-client.js','lib/app/discovery-infrastructure.js','lib/app/discovery-filters.js','lib/app/date-match.js','lib/app/date-match-rules.js','lib/app/location-plans-data.js','lib/app/matches-data.js','lib/app/static-catalogue.js','lib/media/pipeline.js',
  'scripts/check-secrets.mjs','scripts/check-client-boundaries.mjs','scripts/check-duplicate-assets.mjs','scripts/check-security-surface.mjs','scripts/check-bundle-size.mjs','scripts/cleanup-orphaned-media.mjs','scripts/cleanup-r2-assets.mjs',
  'supabase/migrations/10003_date_match.sql','supabase/migrations/10016_remove_notifications_and_pwa.sql','supabase/migrations/10028_r2_runtime_second_optimization.sql','supabase/seed.sql','tests/unit/date-match.test.mjs','tests/unit/group-context.test.mjs','docs/AUTH_SETUP.md','docs/DATE_MATCH.md'
]
for (const path of required) await access(join(root, path))

const removed = [
  'public/manifest.webmanifest','public/sw.js','public/puddle-app-icon.svg','components/pwa-client.js',
  'app/notifications/page.js','components/notification-center.js','app/api/notifications/route.js','app/api/push/subscriptions/route.js',
  'lib/app/notifications-data.js','lib/push/web-push.js','scripts/deliver-push-notifications.mjs','scripts/generate-vapid-keys.mjs','scripts/process-notification-outbox.mjs',
  'app/api/discovery/action/route.js','lib/app/discovery.js','lib/product-vision.js','supabase/migrations/10029_r2_cleanup_batch_preview.sql',
  'app/events','app/explore','app/friends','app/inbox','app/wallet','app/orders','app/settings/payouts','app/admin/finance','app/create/event','app/studio/events','app/studio/hosts',
  'app/api/stripe','app/api/tickets','app/api/check-in','app/api/location-sharing','app/api/conversations','app/api/maps','app/api/ai','app/api/studio/events',
  'lib/stripe','lib/tickets','lib/app/social-data.js','lib/app/plans-data.js','lib/app/ticketing-data.js','lib/app/hybrid-recommendations.js',
  'components/event-editor.js','components/listing-social.js','components/ticket-wallet.js','components/discovery-workspace.js'
]
for (const path of removed) {
  try {
    await access(join(root, path))
    throw new Error(`Removed legacy file is still present: ${path}`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

const syntaxFiles = [
  'next.config.mjs','proxy.js','lib/supabase/env.js','lib/supabase/server.js','lib/supabase/proxy.js','lib/supabase/admin.js','lib/auth/redirect.js','lib/app/discovery-infrastructure.js','lib/app/discovery-filters.js','lib/app/date-match.js','lib/app/date-match-rules.js','lib/app/location-plans-data.js','lib/app/matches-data.js','lib/app/static-catalogue.js','lib/media/pipeline.js',
  'scripts/check.mjs','scripts/check-secrets.mjs','scripts/check-client-boundaries.mjs','scripts/check-duplicate-assets.mjs','scripts/check-security-surface.mjs','scripts/check-bundle-size.mjs','scripts/cleanup-orphaned-media.mjs','scripts/cleanup-r2-assets.mjs','public/app.js','app/auth/actions.js','app/onboarding/actions.js','app/api/discovery/route.js','app/api/discovery/actions/route.js','app/api/date-match/start/route.js','app/api/date-match/action/route.js','app/api/date-match/[token]/route.js','app/api/media/upload/route.js','app/api/geocode/route.js','app/auth/callback/route.js','app/auth/confirm/route.js'
]
for (const path of syntaxFiles) execFileSync(process.execPath, ['--check', join(root, path)], { stdio: 'pipe' })

const read = (path) => readFile(join(root, path), 'utf8')
const requireIncludes = (source, markers, label) => {
  for (const marker of markers) if (!source.includes(marker)) throw new Error(`${label} is missing ${marker}`)
}

const pkg = JSON.parse(await read('package.json'))
for (const dependency of ['@supabase/ssr','@supabase/supabase-js','next','react','react-dom','sharp']) {
  if (!pkg.dependencies?.[dependency]) throw new Error(`Missing dependency: ${dependency}`)
}
for (const command of ['check-secrets.mjs','check-client-boundaries.mjs','check-duplicate-assets.mjs','check-security-surface.mjs','check-bundle-size.mjs']) {
  if (!JSON.stringify(pkg.scripts).includes(command)) throw new Error(`Package scripts are missing ${command}`)
}
for (const command of Object.keys(pkg.scripts || {})) {
  if (command.startsWith('legacy:')) throw new Error(`Legacy package command remains: ${command}`)
}

const env = await read('.env.example')
for (const marker of ['PUDDLE_LEGACY_SYSTEMS_ENABLED','STRIPE_SECRET_KEY','TICKET_SIGNING_PRIVATE_KEY_BASE64','LOCAL_AI_GENERATION_MODEL']) {
  if (env.includes(marker)) throw new Error(`Obsolete environment setting remains: ${marker}`)
}

const vercel = JSON.parse(await read('vercel.json'))
if (!String(vercel.ignoreCommand || '').includes('process.exit(0)')) throw new Error('Vercel build skipping is not enabled for the current development window')

const proxy = await read('proxy.js')
for (const route of ['/dashboard','/discover','/date-match','/hangout','/matches','/plans','/profile','/onboarding','/account','/admin']) {
  if (!proxy.includes(route)) throw new Error(`Proxy does not protect ${route}`)
}
requireIncludes(proxy, ['publicNoSessionPaths','hasSupabaseAuthCookie','needsSession','await updateSession(request, requestHeaders)','cachePolicy'], 'Proxy optimization')
if (proxy.indexOf('if (!needsSession)') > proxy.indexOf('await updateSession(request, requestHeaders)')) throw new Error('Supabase session lookup must be gated')
if (/legacySystemsEnabled|legacyRedirectForPath|isLegacyApiPath|stripe\/webhook/.test(proxy)) throw new Error('Legacy routing logic remains in proxy')

const landingConnector = await read('public/app.js')
requireIncludes(landingConnector, ["replaceButtonWithLink(headerSignInButton, 'Sign In', signInPath)","replaceButtonWithLink(button, 'Register', registrationPath",'renderDeck()'], 'Landing connector')
if (landingConnector.includes('landing-demo.js')) throw new Error('Removed landing prototype is still loaded')

const authShell = await read('components/auth-shell.js')
if (!authShell.includes('Back to home')) throw new Error('Auth pages need a home link')
const signIn = await read('app/signin/page.js')
const signUp = await read('app/signup/page.js')
const authActions = await read('app/auth/actions.js')
for (const source of [signIn, signUp]) {
  if (source.includes('value="apple"') || source.includes('>Apple<')) throw new Error('Apple authentication button must not be displayed')
  requireIncludes(source, ['Continue with Google', "gridTemplateColumns: '1fr'"], 'Authentication page')
}
requireIncludes(signIn, ['Email me a one-time login code','Sign in with code'], 'Email sign-in')
if (!authActions.includes("verifyOtp({ email, token, type: 'email' })")) throw new Error('Email OTP verification is missing')

const layout = await read('app/layout.js')
requireIncludes(layout, ["import './minimal-product.css'", "import './group-map.css'", 'ServiceWorkerCleanup'], 'Minimal product layout')
if (/stage-five|stage-six|manifest\.webmanifest|PwaClient|appleWebApp/.test(layout)) throw new Error('Removed legacy/PWA assets remain active')

const dashboard = await read('app/dashboard/page.js')
requireIncludes(dashboard, ["redirect('/discover')"], 'Swipe-first dashboard redirect')
if (/getHomeSnapshot|HomeMoodShortcuts|home-primary-card/.test(dashboard)) throw new Error('Dashboard content was not removed')

const productNav = await read('components/product-nav.js')
for (const label of ['Swipe','Saved','Matches','Profile']) if (!productNav.includes(`label: '${label}'`)) throw new Error(`Minimal navigation is missing ${label}`)
for (const removedLabel of ['Home','Saved & plans','Your next move','Find a location','Preferences and account']) if (productNav.includes(`'${removedLabel}'`)) throw new Error(`Navigation still exposes ${removedLabel}`)
const productShell = await read('components/product-shell.js')
requireIncludes(productShell, ['minimal-product-sidebar','profile-menu-panel','/account','signOut'], 'Minimal product shell')

const onboarding = await read('app/onboarding/page.js')
const onboardingAction = await read('app/onboarding/actions.js')
requireIncludes(onboarding, ['What kinds of places do you like for dates?','date_locations','Build my date deck'], 'Date-location onboarding')
requireIncludes(onboardingAction, ['allowedDateLocations','interests: dateLocations',"redirect(pathWithMessage('/discover'"], 'Date-location onboarding action')

const discoverPage = await read('app/discover/page.js')
const discovery = await read('lib/app/discovery-infrastructure.js')
const actions = await read('app/api/discovery/actions/route.js')
const swipe = await read('components/date-swipe-workspace-v2.js')
const card = await read('components/minimal-swipe-card.js')
const swipeDock = await read('components/swipe-action-dock.js')
requireIncludes(discoverPage, ["kind: 'place'",'DateSwipeWorkspaceV2','recordSampledInfrastructureAnalytics','limit: 12'], 'Swipe page')
requireIncludes(discovery, ['r2_discovery_overlay_v1','r2-primary','R2_CATALOGUE_NOT_CONFIGURED','record_discovery_session_sample_v1'], 'R2 discovery runtime')
for (const forbidden of ['getDiscoveryFeed','supabase-fallback','logInfrastructureDiscoveryImpressions']) if (discovery.includes(forbidden)) throw new Error(`Discovery fallback remains: ${forbidden}`)
requireIncludes(actions, ['MAX_ACTIONS = 20','record_discovery_actions_v3','materializeStaticCatalogueReferences'], 'Batched action endpoint')
requireIncludes(swipe, ['MinimalSwipeCard','SwipeActionDock','FilterSheet','InviteSheet',"'/api/discovery/actions'",'flushPendingActions'], 'Minimal swipe workspace')
requireIncludes(card, ['minimal-swipe-photo','opening_hours','amenities','google.com/maps','Full details'], 'Minimal location card')
for (const marker of ["key: 'undo'", "key: 'pass'", "key: 'save'", "key: 'perfect'"]) if (!swipeDock.includes(marker)) throw new Error(`Swipe dock is missing ${marker}`)

const plans = await read('app/plans/page.js')
requireIncludes(plans, ["['saved', 'Saved']", "['planned', 'Plans']", "params?.tab === 'past'", 'minimal-place-card','History'], 'Saved and plans page')
const matches = await read('app/matches/page.js')
const matchesData = await read('lib/app/matches-data.js')
requireIncludes(matches, ['Active rooms','Matched places','getMatchesSnapshot'], 'Matches page')
requireIncludes(matchesData, ['date_match_members','date_match_decks','date_match_matches'], 'Matches data')
const profile = await read('app/profile/page.js')
requireIncludes(profile, ['Search radius','Preferences','Account settings','Advanced'], 'Minimal profile')

const runtimeMigration = await read('supabase/migrations/10028_r2_runtime_second_optimization.sql')
requireIncludes(runtimeMigration, ['record_discovery_actions_v3','discovery_action_receipts','prepare_r2_cleanup_v2','drop function if exists public.record_discovery_action_v2'], 'Permanent R2 migration')
if (/record_discovery_action_v2\s*\(|prepare_r2_cleanup_v1\s*\(/.test(runtimeMigration.replace(/drop function if exists/g, ''))) throw new Error('Obsolete RPC calls remain in the permanent migration')

const cleanup = await read('scripts/cleanup-r2-assets.mjs')
requireIncludes(cleanup, ['release-registry.json is required','prepare_r2_cleanup_v2'], 'R2 cleanup')
if (cleanup.includes("allObjects('catalogue/releases/')")) throw new Error('Release-prefix discovery fallback remains')

const dateMatchMigration = await read('supabase/migrations/10003_date_match.sql')
for (const marker of ['date_match_decks','date_match_members','date_match_swipes','date_match_matches','invite_token_hash','create_date_match_v1','join_date_match_v1','record_date_match_swipe_v1','date_match_reveals_v1']) if (!dateMatchMigration.includes(marker)) throw new Error(`DateMatch migration is missing ${marker}`)
const cleanupMigration = await read('supabase/migrations/10016_remove_notifications_and_pwa.sql')
requireIncludes(cleanupMigration, ['drop table if exists public.push_subscriptions','drop table if exists public.app_notifications','drop table if exists public.notification_outbox','create or replace function public.record_date_match_swipe_v1'], 'Notification cleanup migration')

const pipeline = await read('lib/media/pipeline.js')
requireIncludes(pipeline, ['detectedMime','declared !== mime','limitInputPixels','.webp(','sha256','puddle-quarantine','pdfLooksSafe','/encrypt'], 'Secure media pipeline')
const upload = await read('app/api/media/upload/route.js')
requireIncludes(upload, ['createAdminClient','processMediaFile','attachAsset','verifyCsrf','enforceRateLimit'], 'Server-only media upload pipeline')

console.log('Puddle repository validation checks passed.')
