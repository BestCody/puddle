import { access, readFile, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const required = [
  'package.json','vercel.json','next.config.mjs','proxy.js','.env.example','index.html','styles.css','app.js',
  'public/landing.html','public/styles.css','public/app.js','app/layout.js','app/auth.css','app/product.css','app/stage-two.css','app/stage-three-four.css','app/loading.js','app/error.js',
  'app/signin/page.js','app/signup/page.js','app/forgot-password/page.js','app/update-password/page.js','app/auth/actions.js','app/auth/callback/route.js','app/auth/confirm/route.js','app/auth/error/page.js',
  'app/onboarding/page.js','app/dashboard/page.js','app/account/page.js','app/api/auth/session/route.js',
  'app/discover/page.js','app/explore/page.js','app/plans/page.js','app/plans/[id]/page.js','app/plans/[id]/calendar/route.js','app/plans/actions.js',
  'app/create/page.js','app/create/event/page.js','app/create/place/page.js','app/create/actions.js','app/events/[slug]/join/page.js','app/events/[slug]/calendar/route.js','app/places/[slug]/plan/page.js',
  'app/studio/events/[id]/page.js','app/studio/events/[id]/preview/page.js','app/studio/events/[id]/attendees/page.js','app/studio/places/[id]/page.js','app/studio/places/[id]/preview/page.js',
  'app/events/[slug]/page.js','app/places/[slug]/page.js','app/places/[slug]/claim/page.js','app/hosts/[slug]/page.js','app/report/page.js','app/report/actions.js','app/api/drafts/[kind]/route.js',
  'app/api/media/upload/route.js','app/api/media/[id]/signed-url/route.js','app/api/geocode/route.js','app/api/discovery/route.js','app/api/discovery/action/route.js','app/api/maps/in-view/route.js',
  'app/friends/page.js','app/inbox/page.js','app/profile/page.js','app/profile/media/page.js',
  'components/auth-shell.js','components/product-shell.js','components/product-nav.js','components/empty-state.js','components/event-editor.js','components/location-editor.js','components/editor-shared.js','components/revision-history.js','components/public-listing.js',
  'components/media-uploader.js','components/geocode-fields.js','components/discovery-workspace.js','components/content-action-button.js','components/attendee-manager.js',
  'lib/supabase/client.js','lib/supabase/server.js','lib/supabase/proxy.js','lib/supabase/admin.js','lib/auth/user.js','lib/app/stage-one-data.js','lib/app/render-product-page.js',
  'lib/app/content-input.js','lib/app/creator-data.js','lib/app/public-content.js','lib/app/geocoding.js','lib/app/discovery.js','lib/app/plans-data.js','lib/media/pipeline.js',
  'scripts/cleanup-orphaned-media.mjs',
  'supabase/migrations/0002_authentication.sql','supabase/migrations/0003_unified_product_foundation.sql','supabase/migrations/0004_remove_person_matching_legacy.sql','supabase/migrations/0005_content_creation_and_publication.sql','supabase/migrations/0006_private_address_isolation.sql','supabase/migrations/0007_private_address_integrity.sql','supabase/migrations/0008_secure_media_and_discovery.sql','supabase/migrations/0009_plans_rsvps_and_collaboration.sql',
  'supabase/tests/0003_stage1_authorization.sql','supabase/tests/0005_stage2_authorization.sql','supabase/tests/0008_stage3_authorization.sql','supabase/tests/0009_stage4_authorization.sql','supabase/seed.sql','docs/AUTH_SETUP.md','docs/STAGE_3_4_SETUP.md'
]
for (const path of required) await access(join(root, path))

const syntaxFiles = [
  'next.config.mjs','proxy.js','lib/supabase/env.js','lib/supabase/server.js','lib/supabase/proxy.js','lib/supabase/admin.js','lib/auth/redirect.js','lib/app/stage-one-data.js','lib/app/content-input.js','lib/app/creator-data.js','lib/app/public-content.js','lib/app/geocoding.js','lib/app/discovery.js','lib/app/plans-data.js','lib/media/pipeline.js','scripts/check.mjs','scripts/cleanup-orphaned-media.mjs','app/auth/actions.js','app/create/actions.js','app/plans/actions.js','app/report/actions.js','app/api/drafts/[kind]/route.js','app/api/media/upload/route.js','app/api/media/[id]/signed-url/route.js','app/api/geocode/route.js','app/api/discovery/route.js','app/api/discovery/action/route.js','app/api/maps/in-view/route.js','app/events/[slug]/calendar/route.js','app/plans/[id]/calendar/route.js','app/auth/callback/route.js','app/auth/confirm/route.js'
]
for (const path of syntaxFiles) execFileSync(process.execPath, ['--check', join(root, path)], { stdio: 'pipe' })

for (const [source, served] of [['index.html','public/landing.html'],['styles.css','public/styles.css'],['app.js','public/app.js']]) {
  const [left,right] = await Promise.all([readFile(join(root,source)), readFile(join(root,served))])
  if (!left.equals(right)) throw new Error(`${served} does not exactly match ${source}`)
}
try { const bootstrap=await stat(join(root,'.bootstrap')); if(bootstrap.isDirectory()) throw new Error('.bootstrap must not exist') } catch(error) { if(error?.code!=='ENOENT') throw error }

const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
for (const dependency of ['@supabase/ssr','@supabase/supabase-js','next','react','react-dom','sharp']) if(!pkg.dependencies?.[dependency]) throw new Error(`Missing dependency: ${dependency}`)
const vercel=JSON.parse(await readFile(join(root,'vercel.json'),'utf8'))
if(!String(vercel.ignoreCommand||'').includes('process.exit(0)')) throw new Error('Vercel build skipping is not enabled for the current development window')

const proxy=await readFile(join(root,'proxy.js'),'utf8')
for (const route of ['/dashboard','/discover','/explore','/plans','/create','/studio','/report','/friends','/inbox','/profile','/onboarding','/account']) if(!proxy.includes(route)) throw new Error(`Proxy does not protect ${route}`)
for (const route of ['/','/privacy','/terms']) if(!proxy.includes(`'${route}'`)) throw new Error(`Proxy public-session bypass is missing ${route}`)
const publicBypassIndex=proxy.indexOf('if (publicNoSessionPaths.has(pathname))')
const sessionLookupIndex=proxy.indexOf('await updateSession(request, requestHeaders)')
if(publicBypassIndex<0 || sessionLookupIndex<0 || publicBypassIndex>sessionLookupIndex) throw new Error('Public pages must bypass the Supabase session lookup')
const landingConnector=await readFile(join(root,'app.js'),'utf8')
if(!landingConnector.includes("replaceButtonWithLink(headerSignInButton, 'Sign In', signInPath)")) throw new Error('Landing Sign In link changed')
if(!landingConnector.includes("replaceButtonWithLink(button, 'Register', registrationPath")) throw new Error('Landing registration CTA changed')
const authShell=await readFile(join(root,'components/auth-shell.js'),'utf8')
if(!authShell.includes('Back to home')) throw new Error('Auth pages need a home link')
for (const path of ['app/signin/page.js','app/signup/page.js','proxy.js','app/status/route.js','app/auth/callback/route.js','app/auth/confirm/route.js','components/discovery-workspace.js','app/api/geocode/route.js']) {
  const source=await readFile(join(root,path),'utf8')
  if(/Setup needed|Supabase is not configured|Add the Supabase environment variables|Stage 3 migration|geocoding provider has not been connected/i.test(source)) throw new Error(`Developer setup copy leaked into ${path}`)
}

const signIn=await readFile(join(root,'app/signin/page.js'),'utf8')
const signUp=await readFile(join(root,'app/signup/page.js'),'utf8')
const authActions=await readFile(join(root,'app/auth/actions.js'),'utf8')
for (const source of [signIn,signUp]) {
  if(source.includes('value="apple"') || source.includes('>Apple<')) throw new Error('Apple authentication button must not be displayed')
  if(!source.includes('Continue with Google') || !source.includes("gridTemplateColumns: '1fr'")) throw new Error('Full-width Google authentication is missing')
}
if(!signIn.includes('Email me a one-time login code') || !signIn.includes('Sign in with code')) throw new Error('Email login code flow is incomplete')
if(!authActions.includes("verifyOtp({ email, token, type: 'email' })")) throw new Error('Email OTP verification is missing')

const productNav=await readFile(join(root,'components/product-nav.js'),'utf8')
for (const label of ['Discover','Explore','Plans','Create','Friends','Inbox','Profile']) if(!productNav.includes(label)) throw new Error(`Unified navigation is missing ${label}`)
const dashboard=await readFile(join(root,'app/dashboard/page.js'),'utf8')
if(!dashboard.includes("redirect('/discover')")) throw new Error('Legacy dashboard must redirect to Discover')

const stage1=await readFile(join(root,'supabase/migrations/0003_unified_product_foundation.sql'),'utf8')
for (const table of ['host_profiles','host_members','locations','event_permissions','user_content_states']) if(!stage1.includes(`public.${table}`)) throw new Error(`Stage 1 migration is missing ${table}`)
const removal=await readFile(join(root,'supabase/migrations/0004_remove_person_matching_legacy.sql'),'utf8')
for (const term of ['profile_swipes','matches','dating_enabled']) if(!removal.includes(term)) throw new Error(`Legacy person-matching cleanup is missing ${term}`)

const eventEditor=await readFile(join(root,'components/event-editor.js'),'utf8')
const locationEditor=await readFile(join(root,'components/location-editor.js'),'utf8')
for (const marker of ['autosave','recurrence_rule','attendee_questions','exact_address_after_rsvp','requestEventPublication']) if(!eventEditor.includes(marker)) throw new Error(`Event editor is missing ${marker}`)
for (const marker of ['autosave','opening_hours','amenities','price_level','GeocodeFields','requestLocationPublication']) if(!locationEditor.includes(marker)) throw new Error(`Location editor is missing ${marker}`)
const stage2=await readFile(join(root,'supabase/migrations/0005_content_creation_and_publication.sql'),'utf8')
for (const table of ['event_occurrences','event_revisions','location_revisions','location_claims']) if(!stage2.includes(`public.${table}`)) throw new Error(`Stage 2 migration is missing ${table}`)
const privacy=await readFile(join(root,'supabase/migrations/0006_private_address_isolation.sql'),'utf8')
if(!privacy.includes('event_private_details') || !privacy.includes('location_private_details')) throw new Error('Private address isolation is missing')

const pipeline=await readFile(join(root,'lib/media/pipeline.js'),'utf8')
for (const marker of ['detectedMime','limitInputPixels','.webp(','sha256','puddle-quarantine','pdfLooksSafe']) if(!pipeline.includes(marker)) throw new Error(`Secure media pipeline is missing ${marker}`)
const upload=await readFile(join(root,'app/api/media/upload/route.js'),'utf8')
if(!upload.includes('createAdminClient') || !upload.includes('processMediaFile') || !upload.includes('attachAsset')) throw new Error('Server-only media upload pipeline is incomplete')
const stage3=await readFile(join(root,'supabase/migrations/0008_secure_media_and_discovery.sql'),'utf8')
for (const table of ['media_assets','event_media','location_media','message_media','verification_documents','discovery_impressions','discovery_actions']) if(!stage3.includes(`public.${table}`)) throw new Error(`Stage 3 migration is missing ${table}`)
for (const fn of ['discover_candidates_v1','content_in_view_v1','record_discovery_action_v1','assert_media_pointer']) if(!stage3.includes(`public.${fn}`)) throw new Error(`Stage 3 migration is missing ${fn}`)
for (const marker of ['locations_discovery_gix','st_dwithin','st_makebox2d','service-role only','events_validate_cover']) if(!stage3.includes(marker)) throw new Error(`Stage 3 geographic or media integrity is missing ${marker}`)
if(stage3.includes('users upload public media into own folder') || stage3.includes('users upload quarantine files into own folder')) throw new Error('Clients can bypass the secure media route')
const discovery=await readFile(join(root,'components/discovery-workspace.js'),'utf8')
for (const marker of ["['deck','list','map']",'openNow','accessible','available','Use my location','Undo last choice']) if(!discovery.includes(marker)) throw new Error(`Discovery workspace is missing ${marker}`)
const ranking=await readFile(join(root,'lib/app/discovery.js'),'utf8')
for (const marker of ['scoreHybridCandidate','diversifyRecommendations','RULES_FALLBACK_VERSION','logDiscoveryImpressions','dismissed']) if(!ranking.includes(marker)) throw new Error(`Rules-based discovery is missing ${marker}`)
const stage3Test=await readFile(join(root,'supabase/tests/0008_stage3_authorization.sql'),'utf8')
if(!stage3Test.includes('Authenticated clients can bypass the server media pipeline') || !stage3Test.includes('PostGIS discovery index is missing')) throw new Error('Stage 3 authorization assertions are incomplete')

const stage4=await readFile(join(root,'supabase/migrations/0009_plans_rsvps_and_collaboration.sql'),'utf8')
for (const table of ['event_checkins','location_visits','plans','plan_members','plan_availability','plan_stops','plan_polls','plan_poll_options','plan_votes','plan_messages']) if(!stage4.includes(`public.${table}`)) throw new Error(`Stage 4 migration is missing ${table}`)
for (const fn of ['request_event_attendance_v1','cancel_event_attendance_v1','approve_event_attendance_v1','promote_event_waitlist_v1','promote_event_waitlist_as_manager_v1','check_in_attendee_v1','respond_plan_invitation_v1','add_plan_stop_v1']) if(!stage4.includes(`public.${fn}`)) throw new Error(`Stage 4 workflow is missing ${fn}`)
for (const marker of ['for update','skip locked','event_waitlist_position_unique','drop policy if exists "own rsvps"','plan_members_protect_identity','meeting_point']) if(!stage4.includes(marker)) throw new Error(`Stage 4 transaction or authorization control is missing ${marker}`)
const plansPage=await readFile(join(root,'app/plans/page.js'),'utf8')
for (const tab of ['saved_events','saved_places','interested','going','tickets','hosting','shared','past']) if(!plansPage.includes(`'${tab}'`)) throw new Error(`Plans is missing ${tab}`)
const planDetail=await readFile(join(root,'app/plans/[id]/page.js'),'utf8')
for (const marker of ['InvitationCard','Availability','plan-option-picker','Plan chat','Export calendar']) if(!planDetail.includes(marker)) throw new Error(`Collaborative plan UI is missing ${marker}`)
const planActions=await readFile(join(root,'app/plans/actions.js'),'utf8')
for (const marker of ['requestEventAttendance','recordLocationVisit','createPlanPoll','respond_plan_invitation_v1','addPlanStop']) if(!planActions.includes(marker)) throw new Error(`Stage 4 actions are missing ${marker}`)
const stage4Test=await readFile(join(root,'supabase/tests/0009_stage4_authorization.sql'),'utf8')
if(!stage4Test.includes('Direct RSVP writes still bypass transactional capacity controls') || !stage4Test.includes('Plan membership role protection trigger is missing')) throw new Error('Stage 4 authorization assertions are incomplete')

console.log('Puddle Stages 1–4 validation checks passed.')
