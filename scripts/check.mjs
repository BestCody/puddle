import { access, readFile, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const required = [
  'package.json','next.config.mjs','proxy.js','.env.example','index.html','styles.css','app.js',
  'public/landing.html','public/styles.css','public/app.js','app/layout.js','app/auth.css',
  'app/signin/page.js','app/signup/page.js','app/forgot-password/page.js','app/update-password/page.js',
  'app/auth/actions.js','app/auth/callback/route.js','app/auth/confirm/route.js','app/auth/error/page.js',
  'app/onboarding/page.js','app/dashboard/page.js','app/account/page.js','app/api/auth/session/route.js',
  'components/auth-shell.js','lib/supabase/client.js','lib/supabase/server.js','lib/supabase/proxy.js','lib/auth/user.js',
  'supabase/migrations/0002_authentication.sql','docs/AUTH_SETUP.md'
]
for (const path of required) await access(join(root, path))
for (const path of ['next.config.mjs','proxy.js','lib/supabase/env.js','lib/supabase/server.js','lib/supabase/proxy.js','lib/auth/redirect.js','scripts/check.mjs','app/auth/callback/route.js','app/auth/confirm/route.js']) {
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
for (const route of ['/dashboard','/onboarding','/account']) if(!proxy.includes(route)) throw new Error(`Proxy does not protect ${route}`)
const landingConnector=await readFile(join(root,'app.js'),'utf8')
if(!landingConnector.includes("replaceButtonWithLink(headerSignInButton, 'Sign In', signInPath)")) throw new Error('Landing header does not link Sign In correctly')
if(!landingConnector.includes("replaceButtonWithLink(button, 'Register', registrationPath")) throw new Error('Landing registration CTA is missing')
const authShell=await readFile(join(root,'components/auth-shell.js'),'utf8')
if(!authShell.includes('Back to home')) throw new Error('Auth pages need a home link')
for (const path of ['app/signin/page.js','app/signup/page.js','proxy.js','app/status/route.js','app/auth/callback/route.js','app/auth/confirm/route.js']) {
  const source=await readFile(join(root,path),'utf8')
  if(/Setup needed|Supabase is not configured|Add the Supabase environment variables/i.test(source)) throw new Error(`Developer setup copy leaked into ${path}`)
}
console.log('Authentication navigation and public-copy checks passed.')
