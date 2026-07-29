import { access, readFile, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const required = [
  'package.json','next.config.mjs','proxy.js','.env.example','index.html','styles.css','app.js',
  'public/landing.html','public/styles.css','public/app.js','app/layout.js','app/auth.css','app/product.css','app/loading.js','app/error.js',
  'app/signin/page.js','app/signup/page.js','app/forgot-password/page.js','app/update-password/page.js',
  'app/auth/actions.js','app/auth/callback/route.js','app/auth/confirm/route.js','app/auth/error/page.js',
  'app/onboarding/page.js','app/dashboard/page.js','app/account/page.js','app/api/auth/session/route.js',
  'app/discover/page.js','app/explore/page.js','app/plans/page.js','app/create/page.js','app/friends/page.js','app/inbox/page.js','app/profile/page.js',
  'components/auth-shell.js','components/product-shell.js','components/product-nav.js','components/discovery-deck.js','components/empty-state.js',
  'lib/supabase/client.js','lib/supabase/server.js','lib/supabase/proxy.js','lib/auth/user.js','lib/app/stage-one-data.js','lib/app/render-product-page.js',
  'supabase/migrations/0002_authentication.sql','supabase/migrations/0003_unified_product_foundation.sql','supabase/migrations/0004_remove_person_matching_legacy.sql',
  'supabase/tests/0003_stage1_authorization.sql','supabase/seed.sql','docs/AUTH_SETUP.md'
]
for (const path of required) await access(join(root, path))
for (const path of ['next.config.mjs','scripts/check.mjs']) {
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
for (const route of ['/dashboard','/discover','/explore','/plans','/create','/friends','/inbox','/profile','/onboarding','/account']) if(!proxy.includes(route)) throw new Error(`Proxy does not protect ${route}`)
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
const actions=await readFile(join(root,'app/auth/actions.js'),'utf8')
for (const source of [signIn,signUp]) {
  if(source.includes('value="apple"') || source.includes('>Apple<')) throw new Error('Apple authentication button must not be displayed')
  if(!source.includes('Continue with Google')) throw new Error('Google authentication button is missing')
  if(!source.includes("gridTemplateColumns: '1fr'")) throw new Error('Google authentication control must be full width')
}
if(!signIn.includes('Email me a one-time login code')) throw new Error('One-time login code request is missing')
if(!signIn.includes('Sign in with code')) throw new Error('One-time login code verification form is missing')
if(!actions.includes("verifyOtp({ email, token, type: 'email' })")) throw new Error('Email OTP verification is missing')
if(actions.includes("['google', 'apple']")) throw new Error('Apple OAuth remains enabled in the public action')

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
console.log('Stage 1 unified product checks passed.')
