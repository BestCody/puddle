import { access, readFile, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const required = [
  'package.json','next.config.mjs','proxy.js','.env.example','index.html','styles.css','app.js',
  'public/landing.html','public/styles.css','public/app.js','app/layout.js','app/auth.css','app/product.css','app/stage-two.css','app/loading.js','app/error.js',
  'app/signin/page.js','app/signup/page.js','app/forgot-password/page.js','app/update-password/page.js',
  'app/auth/actions.js','app/auth/callback/route.js','app/auth/confirm/route.js','app/auth/error/page.js',
  'app/onboarding/page.js','app/dashboard/page.js','app/account/page.js','app/api/auth/session/route.js',
  'app/discover/page.js','app/explore/page.js','app/plans/page.js','app/create/page.js','app/create/event/page.js','app/create/place/page.js','app/create/actions.js',
  'app/studio/events/[id]/page.js','app/studio/events/[id]/preview/page.js','app/studio/places/[id]/page.js','app/studio/places/[id]/preview/page.js',
  'app/events/[slug]/page.js','app/places/[slug]/page.js','app/places/[slug]/claim/page.js','app/hosts/[slug]/page.js','app/report/page.js','app/report/actions.js','app/api/drafts/[kind]/route.js',
  'app/friends/page.js','app/inbox/page.js','app/profile/page.js',
  'components/auth-shell.js','components/product-shell.js','components/product-nav.js','components/discovery-deck.js','components/empty-state.js',
  'components/event-editor.js','components/location-editor.js','components/editor-shared.js','components/revision-history.js','components/public-listing.js',
  'lib/supabase/client.js','lib/supabase/server.js','lib/supabase/proxy.js','lib/auth/user.js','lib/app/stage-one-data.js','lib/app/render-product-page.js',
  'lib/app/content-input.js','lib/app/creator-data.js','lib/app/public-content.js',
  'supabase/migrations/0002_authentication.sql','supabase/migrations/0003_unified_product_foundation.sql','supabase/migrations/0004_remove_person_matching_legacy.sql','supabase/migrations/0005_content_creation_and_publication.sql','supabase/migrations/0006_private_address_isolation.sql','supabase/migrations/0007_private_address_integrity.sql',
  'supabase/tests/0003_stage1_authorization.sql','supabase/tests/0005_stage2_authorization.sql','supabase/seed.sql','docs/AUTH_SETUP.md'
]
for (const path of required) await access(join(root, path))
for (const path of ['next.config.mjs','proxy.js','lib/supabase/env.js','lib/supabase/server.js','lib/supabase/proxy.js','lib/auth/redirect.js','lib/app/stage-one-data.js','lib/app/content-input.js','lib/app/creator-data.js','lib/app/public-content.js','scripts/check.mjs','app/auth/actions.js','app/create/actions.js','app/report/actions.js','app/api/drafts/[kind]/route.js','app/auth/callback/route.js','app/auth/confirm/route.js']) {
  execFileSync(process.execPath, ['--check', join(root, path)], { stdio: 'pipe' })
}
for (const [source, served] of [['index.html','public/landing.html'],['styles.css','public/styles.css'],['app.js','public/app.js']]) {
  const [left,right] = await Promise.all([readFile(join(root,source)), readFile(join(root,served))])
  if (!left.equals(right)) throw new Error(`${served} does not exactly match ${source}`)
}
try { const bootstrap=await stat(join(root,'.bootstrap')); if(bootstrap.isDirectory()) throw new Error('.bootstrap must not exist') } catch(error) { if(error?.code!=='ENOENT') throw error }
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
for (const dependency of ['@supabase/ssr','@supabase/supabase-js','next','react','react-dom']) if(!pkg.dependencies?.[dependency]) throw new Error(`Missing dependency: ${dependency}`)
const proxy=await readFile(join(root,'proxy.js'),'utf8')
for (const route of ['/dashboard','/discover','/explore','/plans','/create','/studio','/report','/friends','/inbox','/profile','/onboarding','/account']) if(!proxy.includes(route)) throw new Error(`Proxy does not protect ${route}`)
const landingConnector=await readFile(join(root,'app.js'),'utf8')
if(!landingConnector.includes("replaceButtonWithLink(headerSignInButton, 'Sign In', signInPath)")) throw new Error('Landing header does not link Sign In correctly')
if(!landingConnector.includes("replaceButtonWithLink(button, 'Register', registrationPath")) throw new Error('Landing registration CTA is missing')
const authShell=await readFile(join(root,'components/auth-shell.js'),'utf8')
if(!authShell.includes('Back to home')) throw new Error('Auth pages need a home link')
for (const path of ['app/signin/page.js','app/signup/page.js','proxy.js','app/status/route.js','app/auth/callback/route.js','app/auth/confirm/route.js']) {
  const source=await readFile(join(root,path),'utf8')
  if(/Setup needed|Supabase is not configured|Add the Supabase environment variables/i.test(source)) throw new Error(`Developer setup copy leaked into ${path}`)
}
const signIn=await readFile(join(root,'app/signin/page.js'),'utf8')
const signUp=await readFile(join(root,'app/signup/page.js'),'utf8')
const authActions=await readFile(join(root,'app/auth/actions.js'),'utf8')
for (const source of [signIn,signUp]) {
  if(source.includes('value="apple"') || source.includes('>Apple<')) throw new Error('Apple authentication button must not be displayed')
  if(!source.includes('Continue with Google')) throw new Error('Google authentication button is missing')
  if(!source.includes("gridTemplateColumns: '1fr'")) throw new Error('Google authentication control must be full width')
}
if(!signIn.includes('Email me a one-time login code')) throw new Error('One-time login code request is missing')
if(!signIn.includes('Sign in with code')) throw new Error('One-time login code verification form is missing')
if(!authActions.includes("verifyOtp({ email, token, type: 'email' })")) throw new Error('Email OTP verification is missing')
if(authActions.includes("['google', 'apple']")) throw new Error('Apple OAuth remains enabled in the public action')
const productNav=await readFile(join(root,'components/product-nav.js'),'utf8')
for (const label of ['Discover','Explore','Plans','Create','Friends','Inbox','Profile']) if(!productNav.includes(label)) throw new Error(`Unified navigation is missing ${label}`)
const dashboard=await readFile(join(root,'app/dashboard/page.js'),'utf8')
if(!dashboard.includes("redirect('/discover')")) throw new Error('Legacy dashboard must redirect to Discover')
const foundation=await readFile(join(root,'supabase/migrations/0003_unified_product_foundation.sql'),'utf8')
for (const table of ['host_profiles','host_members','locations','event_permissions','user_content_states']) if(!foundation.includes(`public.${table}`)) throw new Error(`Stage 1 migration is missing ${table}`)
for (const role of ['owner','editor','checkin','moderator','finance']) if(!foundation.includes(`'${role}'`)) throw new Error(`Stage 1 permissions are missing ${role}`)
for (const state of ['saved','interested','attending','visited','hosting']) if(!foundation.includes(`'${state}'`)) throw new Error(`Unified content states are missing ${state}`)
const removal=await readFile(join(root,'supabase/migrations/0004_remove_person_matching_legacy.sql'),'utf8')
for (const term of ['profile_swipes','matches','dating_enabled']) if(!removal.includes(term)) throw new Error(`Legacy matching cleanup is missing ${term}`)
const authorization=await readFile(join(root,'supabase/tests/0003_stage1_authorization.sql'),'utf8')
if(!authorization.includes('RLS is not enabled')) throw new Error('Stage 1 authorization tests are incomplete')

const createPage=await readFile(join(root,'app/create/page.js'),'utf8')
if(!createPage.includes('/create/event') || !createPage.includes('/create/place')) throw new Error('Create hub does not open both editors')
const eventEditor=await readFile(join(root,'components/event-editor.js'),'utf8')
const locationEditor=await readFile(join(root,'components/location-editor.js'),'utf8')
for (const marker of ['autosave','recurrence_rule','attendee_questions','exact_address_after_rsvp','requestEventPublication']) if(!eventEditor.includes(marker)) throw new Error(`Event editor is missing ${marker}`)
for (const marker of ['autosave','opening_hours','amenities','price_level','requestLocationPublication']) if(!locationEditor.includes(marker)) throw new Error(`Location editor is missing ${marker}`)
const draftRoute=await readFile(join(root,'app/api/drafts/[kind]/route.js'),'utf8')
if(!draftRoute.includes("['event', 'place']") || !draftRoute.includes('Draft not found')) throw new Error('Autosave API is incomplete')
const stage2=await readFile(join(root,'supabase/migrations/0005_content_creation_and_publication.sql'),'utf8')
for (const table of ['event_occurrences','event_revisions','location_revisions','location_claims']) if(!stage2.includes(`public.${table}`)) throw new Error(`Stage 2 migration is missing ${table}`)
for (const fn of ['request_event_publication','transition_event_status','request_location_publication','transition_location_status','publish_due_events']) if(!stage2.includes(`public.${fn}`)) throw new Error(`Stage 2 workflow is missing ${fn}`)
for (const status of ['draft','pending_review','scheduled','published','postponed','cancelled','rejected','suspended','completed','archived']) if(!stage2.includes(`'${status}'`)) throw new Error(`Stage 2 workflow is missing ${status}`)
for (const field of ['event_format','recurrence_rule','private_address','attendee_questions','opening_hours','contact_links']) if(!stage2.includes(field)) throw new Error(`Stage 2 schema is missing ${field}`)
const privacy=await readFile(join(root,'supabase/migrations/0006_private_address_isolation.sql'),'utf8')
for (const table of ['event_private_details','location_private_details']) if(!privacy.includes(`public.${table}`)) throw new Error(`Private-address migration is missing ${table}`)
if(!privacy.includes('has_private_address') || !privacy.includes('drop column if exists private_address')) throw new Error('Public listing tables still expose exact private addresses')
if(!privacy.includes('event managers manage private details') || !privacy.includes('location managers manage private details')) throw new Error('Private addresses are not isolated behind manager-only RLS')
const privacyIntegrity=await readFile(join(root,'supabase/migrations/0007_private_address_integrity.sql'),'utf8')
for (const trigger of ['event_private_details_sync_flag','location_private_details_sync_flag']) if(!privacyIntegrity.includes(trigger)) throw new Error(`Private-address integrity is missing ${trigger}`)
if(!privacyIntegrity.includes('exists(select 1 from public.event_private_details') || !privacyIntegrity.includes('exists(select 1 from public.location_private_details')) throw new Error('Publication trusts a public private-address flag instead of protected detail rows')
const stage2Test=await readFile(join(root,'supabase/tests/0005_stage2_authorization.sql'),'utf8')
if(!stage2Test.includes('Controlled event status trigger is missing') || !stage2Test.includes('Missing Stage 2 RLS policies')) throw new Error('Stage 2 authorization tests are incomplete')
for (const path of ['app/events/[slug]/page.js','app/places/[slug]/page.js','app/hosts/[slug]/page.js']) {
  const source=await readFile(join(root,path),'utf8')
  if(!source.includes('generateMetadata') || !source.includes('application/ld+json')) throw new Error(`Public metadata or structured data is missing from ${path}`)
}
const publicView=await readFile(join(root,'components/public-listing.js'),'utf8')
for (const marker of ['Report event','Claim location','exact address is hidden','Similar splashes']) if(!publicView.includes(marker)) throw new Error(`Public listing UI is missing ${marker}`)
console.log('Stage 2 creation, publication, public-page, and authorization checks passed.')
