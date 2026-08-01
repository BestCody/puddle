import { access, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const required = [
  'package.json','vercel.json','next.config.mjs','proxy.js','.env.example',
  'public/landing.html','public/styles.css','public/landing-responsive.css','public/app.js','app/layout.js','app/auth.css','app/onboarding.css','app/date-swipe.css','app/swipe-v2.css','app/date-match.css','app/real-place-photos.css','app/product.css','app/sidebar-refresh.css','app/home-dashboard.css','app/stage-two.css','app/stage-three-four.css','app/loading.js','app/error.js',
  'app/admin/layout.js','app/privacy/layout.js','app/terms/layout.js','app/signin/page.js','app/signup/page.js','app/forgot-password/page.js','app/update-password/page.js','app/auth/actions.js','app/auth/callback/route.js','app/auth/confirm/route.js','app/auth/error/page.js',
  'app/onboarding/page.js','app/onboarding/actions.js','app/dashboard/page.js','app/account/page.js','app/api/auth/session/route.js','app/discover/page.js','app/date-match/[token]/page.js','app/explore/page.js','app/plans/page.js','app/plans/[id]/page.js','app/plans/[id]/calendar/route.js','app/plans/actions.js',
  'app/create/page.js','app/create/event/page.js','app/create/place/page.js','app/create/actions.js','app/events/[slug]/join/page.js','app/events/[slug]/calendar/route.js','app/places/[slug]/plan/page.js','app/studio/events/[id]/page.js','app/studio/events/[id]/preview/page.js','app/studio/events/[id]/attendees/page.js','app/studio/places/[id]/page.js','app/studio/places/[id]/preview/page.js',
  'app/events/[slug]/page.js','app/places/[slug]/page.js','app/places/[slug]/claim/page.js','app/hosts/[slug]/page.js','app/report/page.js','app/report/actions.js','app/api/drafts/[kind]/route.js','app/api/media/upload/route.js','app/api/media/[id]/signed-url/route.js','app/api/geocode/route.js','app/api/discovery/route.js','app/api/discovery/action/route.js','app/api/date-match/start/route.js','app/api/date-match/action/route.js','app/api/date-match/[token]/route.js','app/api/maps/in-view/route.js',
  'app/friends/page.js','app/inbox/page.js','app/profile/page.js','app/profile/media/page.js','components/auth-shell.js','components/product-shell.js','components/product-nav.js','components/empty-state.js','components/event-editor.js','components/location-editor.js','components/editor-shared.js','components/revision-history.js','components/public-listing.js','components/media-uploader.js','components/geocode-fields.js','components/discovery-workspace.js','components/date-swipe-workspace.js','components/date-swipe-workspace-v2.js','components/swipe-action-dock.js','components/home-mood-shortcuts.js','components/date-match-workspace.js','components/content-action-button.js','components/attendee-manager.js',
  'lib/supabase/client.js','lib/supabase/server.js','lib/supabase/proxy.js','lib/supabase/admin.js','lib/auth/user.js','lib/auth/redirect.js','lib/security/csrf-client.js','lib/app/stage-one-data.js','lib/app/content-input.js','lib/app/creator-data.js','lib/app/public-content.js','lib/app/geocoding.js','lib/app/discovery.js','lib/app/date-match.js','lib/app/date-match-rules.js','lib/app/plans-data.js','lib/app/home-data.js','lib/media/pipeline.js',
  'scripts/check-secrets.mjs','scripts/check-client-boundaries.mjs','scripts/check-duplicate-assets.mjs','scripts/check-security-surface.mjs','scripts/check-bundle-size.mjs','scripts/cleanup-orphaned-media.mjs','supabase/migrations/10000_performance_security_hardening.sql','supabase/migrations/10003_date_match.sql',
  'supabase/migrations/0002_authentication.sql','supabase/migrations/0003_unified_product_foundation.sql','supabase/migrations/0004_remove_person_matching_legacy.sql','supabase/migrations/0005_content_creation_and_publication.sql','supabase/migrations/0006_private_address_isolation.sql','supabase/migrations/0007_private_address_integrity.sql','supabase/migrations/0008_secure_media_and_discovery.sql','supabase/migrations/0009_plans_rsvps_and_collaboration.sql',
  'supabase/tests/0003_stage1_authorization.sql','supabase/tests/0005_stage2_authorization.sql','supabase/tests/0008_stage3_authorization.sql','supabase/tests/0009_stage4_authorization.sql','supabase/seed.sql','tests/unit/date-match.test.mjs','docs/AUTH_SETUP.md','docs/STAGE_3_4_SETUP.md','docs/DATE_MATCH.md'
]
for (const path of required) await access(join(root, path))

const syntaxFiles = [
  'next.config.mjs','proxy.js','lib/supabase/env.js','lib/supabase/server.js','lib/supabase/proxy.js','lib/supabase/admin.js','lib/auth/redirect.js','lib/app/stage-one-data.js','lib/app/content-input.js','lib/app/creator-data.js','lib/app/public-content.js','lib/app/geocoding.js','lib/app/discovery.js','lib/app/date-match.js','lib/app/date-match-rules.js','lib/app/plans-data.js','lib/app/home-data.js','lib/media/pipeline.js','scripts/check.mjs','scripts/check-secrets.mjs','scripts/check-client-boundaries.mjs','scripts/check-duplicate-assets.mjs','scripts/check-security-surface.mjs','scripts/check-bundle-size.mjs','scripts/cleanup-orphaned-media.mjs','public/app.js','app/auth/actions.js','app/onboarding/actions.js','app/create/actions.js','app/plans/actions.js','app/report/actions.js','app/api/drafts/[kind]/route.js','app/api/media/upload/route.js','app/api/media/[id]/signed-url/route.js','app/api/geocode/route.js','app/api/discovery/route.js','app/api/discovery/action/route.js','app/api/date-match/start/route.js','app/api/date-match/action/route.js','app/api/date-match/[token]/route.js','app/api/maps/in-view/route.js','app/events/[slug]/calendar/route.js','app/plans/[id]/calendar/route.js','app/auth/callback/route.js','app/auth/confirm/route.js'
]
for (const path of syntaxFiles) execFileSync(process.execPath, ['--check', join(root, path)], { stdio: 'pipe' })

const read = (path) => readFile(join(root, path), 'utf8')
const requireIncludes = (source, markers, label) => { for (const marker of markers) if (!source.includes(marker)) throw new Error(`${label} is missing ${marker}`) }

const pkg = JSON.parse(await read('package.json'))
for (const dependency of ['@supabase/ssr','@supabase/supabase-js','next','react','react-dom','sharp']) if (!pkg.dependencies?.[dependency]) throw new Error(`Missing dependency: ${dependency}`)
for (const command of ['check-secrets.mjs','check-client-boundaries.mjs','check-duplicate-assets.mjs','check-security-surface.mjs','check-bundle-size.mjs']) if (!JSON.stringify(pkg.scripts).includes(command)) throw new Error(`Package scripts are missing ${command}`)
const vercel = JSON.parse(await read('vercel.json'))
if (!String(vercel.ignoreCommand || '').includes('process.exit(0)')) throw new Error('Vercel build skipping is not enabled for the current development window')

const proxy = await read('proxy.js')
for (const route of ['/dashboard','/discover','/date-match','/explore','/plans','/create','/studio','/report','/friends','/inbox','/profile','/onboarding','/account','/admin']) if (!proxy.includes(route)) throw new Error(`Proxy does not protect ${route}`)
requireIncludes(proxy, ['publicNoSessionPaths','hasSupabaseAuthCookie','needsSession','await updateSession(request, requestHeaders)','cachePolicy'], 'Proxy optimization')
if (proxy.indexOf('if (!needsSession)') > proxy.indexOf('await updateSession(request, requestHeaders)')) throw new Error('Supabase session lookup must be gated')

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
requireIncludes(layout, ["import './swipe-v2.css'", "import './sidebar-refresh.css'", "import './home-dashboard.css'"], 'Refreshed UI styles')
const dashboard = await read('app/dashboard/page.js')
requireIncludes(dashboard, ['getHomeSnapshot','HomeMoodShortcuts','home-primary-card','Open Swipe','Saved for later'], 'Location-first Home dashboard')
const homeData = await read('lib/app/home-data.js')
requireIncludes(homeData, ['getLocationPlansSnapshot','location_card_quality_v1','chooseLocationPhoto','dateMatchPlanCount'], 'Home dashboard data')
const productNav = await read('components/product-nav.js')
for (const label of ['Home','Swipe','Saved & plans','Inbox','Profile']) if (!productNav.includes(label)) throw new Error(`Detailed navigation is missing ${label}`)
requireIncludes(productNav, ["type === 'swipe'", "href: '/dashboard'", "detail: 'Find a location'"], 'Dedicated Swipe navigation')
const onboarding = await read('app/onboarding/page.js')
const onboardingAction = await read('app/onboarding/actions.js')
requireIncludes(onboarding, ['What kinds of places do you like for dates?','date_locations','Build my date deck'], 'Date-location onboarding')
requireIncludes(onboardingAction, ['allowedDateLocations','interests: dateLocations',"redirect(pathWithMessage('/discover'"], 'Date-location onboarding action')
const discoverPage = await read('app/discover/page.js')
const dateSwipe = await read('components/date-swipe-workspace.js')
const dateSwipeV2 = await read('components/date-swipe-workspace-v2.js')
const swipeDock = await read('components/swipe-action-dock.js')
const dateMatchPage = await read('app/date-match/[token]/page.js')
const dateMatchWorkspace = await read('components/date-match-workspace.js')
const dateMatchMigration = await read('supabase/migrations/10003_date_match.sql')
requireIncludes(discoverPage, ["kind: 'place'",'DateSwipeWorkspaceV2','Your 12-card location deck','limit: 12'], 'Date swipe page')
requireIncludes(dateSwipe, ['onPointerDown','ArrowLeft','ArrowRight','ArrowUp','DateLocationDetails',"choose('pass'", "choose('save'", "choose('perfect'",'Undo last swipe','Swipe together','Puddle Pick'], 'Finite date swipe workspace')
requireIncludes(dateSwipeV2, ['SwipeActionDock','onUndo={undo}',"onPass={() => requestChoice('pass', current)}","onSave={() => requestChoice('save', current)}","onPerfect={() => requestChoice('perfect', current)}",'swipe-v2-progress'], 'Immersive swipe workspace')
for (const marker of ["key: 'undo'", "key: 'pass'", "key: 'save'", "key: 'perfect'"]) if (!swipeDock.includes(marker)) throw new Error(`Swipe dock is missing ${marker}`)
if (!(swipeDock.indexOf("key: 'undo'") < swipeDock.indexOf("key: 'pass'") && swipeDock.indexOf("key: 'pass'") < swipeDock.indexOf("key: 'save'") && swipeDock.indexOf("key: 'save'") < swipeDock.indexOf("key: 'perfect'"))) throw new Error('Swipe controls must remain Undo, Pass, Save, Perfect Pick')
requireIncludes(dateMatchPage, ['DateMatchWorkspace','Choose privately. Match on the dates you both want.'], 'DateMatch page')
requireIncludes(dateMatchWorkspace, ['It’s a DateMatch','Perfect Pick','Plan this date','Keep swiping','Your best date options','shouldPromptDateFeedback','setInterval(refreshRoom, 7000)'], 'Mutual DateMatch workspace')
for (const marker of ['date_match_decks','date_match_members','date_match_swipes','date_match_matches','invite_token_hash','create_date_match_v1','join_date_match_v1','record_date_match_swipe_v1','date_match_reveals_v1']) if (!dateMatchMigration.includes(marker)) throw new Error(`DateMatch migration is missing ${marker}`)

const eventEditor = await read('components/event-editor.js')
const locationEditor = await read('components/location-editor.js')
requireIncludes(eventEditor, ['csrfFetch','recurrence_rule','attendee_questions','exact_address_after_rsvp','requestEventPublication'], 'Event editor')
requireIncludes(locationEditor, ['csrfFetch','opening_hours','amenities','price_level','GeocodeFields','requestLocationPublication'], 'Location editor')

const pipeline = await read('lib/media/pipeline.js')
requireIncludes(pipeline, ['detectedMime','declared !== mime','limitInputPixels','.webp(','sha256','puddle-quarantine','pdfLooksSafe','/encrypt'], 'Secure media pipeline')
const upload = await read('app/api/media/upload/route.js')
requireIncludes(upload, ['createAdminClient','processMediaFile','attachAsset','verifyCsrf','enforceRateLimit'], 'Server-only media upload pipeline')

const stage1 = await read('supabase/migrations/0003_unified_product_foundation.sql')
for (const table of ['host_profiles','host_members','locations','event_permissions','user_content_states']) if (!stage1.includes(`public.${table}`)) throw new Error(`Stage 1 migration is missing ${table}`)
const removal = await read('supabase/migrations/0004_remove_person_matching_legacy.sql')
for (const term of ['profile_swipes','matches','dating_enabled']) if (!removal.includes(term)) throw new Error(`Legacy person-matching cleanup is missing ${term}`)
const stage2 = await read('supabase/migrations/0005_content_creation_and_publication.sql')
for (const table of ['event_occurrences','event_revisions','location_revisions','location_claims']) if (!stage2.includes(`public.${table}`)) throw new Error(`Stage 2 migration is missing ${table}`)
const stage3 = await read('supabase/migrations/0008_secure_media_and_discovery.sql')
for (const marker of ['media_assets','discover_candidates_v1','locations_discovery_gix','service-role only']) if (!stage3.includes(marker)) throw new Error(`Stage 3 migration is missing ${marker}`)
const stage4 = await read('supabase/migrations/0009_plans_rsvps_and_collaboration.sql')
for (const marker of ['event_checkins','plans','request_event_attendance_v1','for update','skip locked']) if (!stage4.includes(marker)) throw new Error(`Stage 4 migration is missing ${marker}`)

console.log('Puddle repository validation checks passed.')
