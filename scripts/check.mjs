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
  'app/onboarding/page.js','app/onboarding/actions.js','app/dashboard/page.js','app/account/page.js','app/discover/page.js','app/date-match/[token]/page.js','app/hangout/[token]/page.js','app/matches/page.js','app/plans/page.js','app/profile/page.js',
  'app/api/auth/session/route.js','app/api/discovery/route.js','app/api/discovery/action/route.js','app/api/date-match/start/route.js','app/api/date-match/action/route.js','app/api/date-match/[token]/route.js','app/api/media/upload/route.js','app/api/geocode/route.js',
  'components/auth-shell.js','components/product-shell.js','components/product-nav.js','components/puddle-logo.js','components/empty-state.js','components/date-swipe-workspace-v2.js','components/minimal-swipe-card.js','components/swipe-action-dock.js','components/date-match-workspace.js','components/service-worker-cleanup.js',
  'lib/supabase/client.js','lib/supabase/server.js','lib/supabase/proxy.js','lib/supabase/admin.js','lib/auth/user.js','lib/auth/redirect.js','lib/security/csrf-client.js','lib/app/discovery.js','lib/app/date-match.js','lib/app/date-match-rules.js','lib/app/location-plans-data.js','lib/app/matches-data.js','lib/media/pipeline.js',
  'scripts/check-secrets.mjs','scripts/check-client-boundaries.mjs','scripts/check-duplicate-assets.mjs','scripts/check-security-surface.mjs','scripts/check-bundle-size.mjs','scripts/cleanup-orphaned-media.mjs',
  'supabase/migrations/10003_date_match.sql','supabase/migrations/10016_remove_notifications_and_pwa.sql','supabase/seed.sql','tests/unit/date-match.test.mjs','tests/unit/group-context.test.mjs','docs/AUTH_SETUP.md','docs/DATE_MATCH.md'
]
for (const path of required) await access(join(root, path))

const removed = [
  'public/manifest.webmanifest','public/sw.js','public/puddle-app-icon.svg','components/pwa-client.js',
  'app/notifications/page.js','components/notification-center.js','app/api/notifications/route.js','app/api/push/subscriptions/route.js',
  'lib/app/notifications-data.js','lib/push/web-push.js','scripts/deliver-push-notifications.mjs','scripts/generate-vapid-keys.mjs','scripts/process-notification-outbox.mjs'
]
for (const path of removed) {
  try { await access(join(root, path)); throw new Error(`Removed install/notification file is still present: ${path}`) }
  catch (error) { if (error?.code !== 'ENOENT') throw error }
}

const syntaxFiles = [
  'next.config.mjs','proxy.js','lib/supabase/env.js','lib/supabase/server.js','lib/supabase/proxy.js','lib/supabase/admin.js','lib/auth/redirect.js','lib/app/discovery.js','lib/app/date-match.js','lib/app/date-match-rules.js','lib/app/location-plans-data.js','lib/app/matches-data.js','lib/media/pipeline.js',
  'scripts/check.mjs','scripts/check-secrets.mjs','scripts/check-client-boundaries.mjs','scripts/check-duplicate-assets.mjs','scripts/check-security-surface.mjs','scripts/check-bundle-size.mjs','scripts/cleanup-orphaned-media.mjs','public/app.js','app/auth/actions.js','app/onboarding/actions.js','app/api/discovery/route.js','app/api/discovery/action/route.js','app/api/date-match/start/route.js','app/api/date-match/action/route.js','app/api/date-match/[token]/route.js','app/api/media/upload/route.js','app/api/geocode/route.js','app/auth/callback/route.js','app/auth/confirm/route.js'
]
for (const path of syntaxFiles) execFileSync(process.execPath, ['--check', join(root, path)], { stdio: 'pipe' })

const read = (path) => readFile(join(root, path), 'utf8')
const requireIncludes = (source, markers, label) => { for (const marker of markers) if (!source.includes(marker)) throw new Error(`${label} is missing ${marker}`) }

const pkg = JSON.parse(await read('package.json'))
for (const dependency of ['@supabase/ssr','@supabase/supabase-js','next','react','react-dom','sharp']) if (!pkg.dependencies?.[dependency]) throw new Error(`Missing dependency: ${dependency}`)
for (const command of ['check-secrets.mjs','check-client-boundaries.mjs','check-duplicate-assets.mjs','check-security-surface.mjs','check-bundle-size.mjs']) if (!JSON.stringify(pkg.scripts).includes(command)) throw new Error(`Package scripts are missing ${command}`)
for (const removedScript of ['notifications:push','notifications:push:apply','notifications:outbox','vapid:generate']) if (pkg.scripts?.[removedScript]) throw new Error(`Removed notification script remains: ${removedScript}`)

const vercel = JSON.parse(await read('vercel.json'))
if (!String(vercel.ignoreCommand || '').includes('process.exit(0)')) throw new Error('Vercel build skipping is not enabled for the current development window')

const proxy = await read('proxy.js')
for (const route of ['/dashboard','/discover','/date-match','/hangout','/matches','/plans','/profile','/onboarding','/account','/admin']) if (!proxy.includes(route)) throw new Error(`Proxy does not protect ${route}`)
requireIncludes(proxy, ['publicNoSessionPaths','hasSupabaseAuthCookie','needsSession','await updateSession(request, requestHeaders)','cachePolicy'], 'Proxy optimization')
if (proxy.indexOf('if (!needsSession)') > proxy.indexOf('await updateSession(request, requestHeaders)')) throw new Error('Supabase session lookup must be gated')
if (proxy.includes("'/notifications'")) throw new Error('Removed notifications page remains protected')

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
if (/manifest\.webmanifest|PwaClient|appleWebApp/.test(layout)) throw new Error('Installable PWA metadata is still active')

const dashboard = await read('app/dashboard/page.js')
requireIncludes(dashboard, ["redirect('/discover')"], 'Swipe-first dashboard redirect')
if (/getHomeSnapshot|HomeMoodShortcuts|home-primary-card/.test(dashboard)) throw new Error('Dashboard content was not removed')

const productNav = await read('components/product-nav.js')
for (const label of ['Swipe','Saved','Matches','Profile']) if (!productNav.includes(`label: '${label}'`)) throw new Error(`Minimal navigation is missing ${label}`)
for (const removedLabel of ['Home','Saved & plans','Your next move','Find a location','Preferences and account']) if (productNav.includes(`'${removedLabel}'`)) throw new Error(`Navigation still exposes ${removedLabel}`)
const productShell = await read('components/product-shell.js')
requireIncludes(productShell, ['minimal-product-sidebar','profile-menu-panel','/account','signOut'], 'Minimal product shell')
for (const clutter of ['location-first','Choose the place—not the person','Better cards first','Find the date spot']) if (productShell.includes(clutter)) throw new Error(`Product shell still contains ${clutter}`)

const onboarding = await read('app/onboarding/page.js')
const onboardingAction = await read('app/onboarding/actions.js')
requireIncludes(onboarding, ['What kinds of places do you like for dates?','date_locations','Build my date deck'], 'Date-location onboarding')
requireIncludes(onboardingAction, ['allowedDateLocations','interests: dateLocations',"redirect(pathWithMessage('/discover'"], 'Date-location onboarding action')

const discoverPage = await read('app/discover/page.js')
const swipe = await read('components/date-swipe-workspace-v2.js')
const card = await read('components/minimal-swipe-card.js')
const swipeDock = await read('components/swipe-action-dock.js')
requireIncludes(discoverPage, ["kind: 'place'",'DateSwipeWorkspaceV2','limit: 12','minimal-swipe-page'], 'Swipe page')
for (const clutter of ['Your 12-card location deck','Find somewhere you actually want to go','swipe-heading-demo']) if (discoverPage.includes(clutter)) throw new Error(`Swipe page still contains ${clutter}`)
requireIncludes(swipe, ['MinimalSwipeCard','SwipeActionDock','FilterSheet','InviteSheet',"persistChoice('pass'", "persistChoice('save'", "persistChoice('perfect'",'Invite others','Swipe again','One person','A group'], 'Minimal swipe workspace')
for (const clutter of ['ChoiceNoteModal','SoloDeckSummary','HangoutSetupModal','Perfect Pick ·','swipe-v2-progress']) if (swipe.includes(clutter)) throw new Error(`Swipe workspace still contains ${clutter}`)
requireIncludes(card, ['minimal-swipe-photo','opening_hours','amenities','google.com/maps','Full details'], 'Minimal location card')
for (const marker of ["key: 'undo'", "key: 'pass'", "key: 'save'", "key: 'perfect'"]) if (!swipeDock.includes(marker)) throw new Error(`Swipe dock is missing ${marker}`)
if (!(swipeDock.indexOf("key: 'undo'") < swipeDock.indexOf("key: 'pass'") && swipeDock.indexOf("key: 'pass'") < swipeDock.indexOf("key: 'save'") && swipeDock.indexOf("key: 'save'") < swipeDock.indexOf("key: 'perfect'"))) throw new Error('Swipe controls must remain Undo, Pass, Save, Perfect')

const plans = await read('app/plans/page.js')
requireIncludes(plans, ["['saved', 'Saved']", "['planned', 'Plans']", "params?.tab === 'past'", 'minimal-place-card','History'], 'Saved and plans page')
const matches = await read('app/matches/page.js')
const matchesData = await read('lib/app/matches-data.js')
requireIncludes(matches, ['Active rooms','Matched places','getMatchesSnapshot'], 'Matches page')
requireIncludes(matchesData, ['date_match_members','date_match_decks','date_match_matches'], 'Matches data')
const profile = await read('app/profile/page.js')
requireIncludes(profile, ['Search radius','Preferences','Account settings','Advanced'], 'Minimal profile')

const dateMatchMigration = await read('supabase/migrations/10003_date_match.sql')
for (const marker of ['date_match_decks','date_match_members','date_match_swipes','date_match_matches','invite_token_hash','create_date_match_v1','join_date_match_v1','record_date_match_swipe_v1','date_match_reveals_v1']) if (!dateMatchMigration.includes(marker)) throw new Error(`DateMatch migration is missing ${marker}`)
const cleanupMigration = await read('supabase/migrations/10016_remove_notifications_and_pwa.sql')
requireIncludes(cleanupMigration, ['drop table if exists public.push_subscriptions','drop table if exists public.app_notifications','drop table if exists public.notification_outbox','create or replace function public.record_date_match_swipe_v1'], 'Notification cleanup migration')
if (cleanupMigration.includes('insert into public.app_notifications')) throw new Error('Notification inserts remain in the final shared-deck functions')

const pipeline = await read('lib/media/pipeline.js')
requireIncludes(pipeline, ['detectedMime','declared !== mime','limitInputPixels','.webp(','sha256','puddle-quarantine','pdfLooksSafe','/encrypt'], 'Secure media pipeline')
const upload = await read('app/api/media/upload/route.js')
requireIncludes(upload, ['createAdminClient','processMediaFile','attachAsset','verifyCsrf','enforceRateLimit'], 'Server-only media upload pipeline')

console.log('Puddle repository validation checks passed.')
