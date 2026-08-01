import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const findings = []
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean)

async function source(path) { return readFile(join(root, path), 'utf8') }
async function requireMarkers(path, markers, value = null) {
  const content = value ?? await source(path)
  for (const marker of markers) if (!content.includes(marker)) findings.push(`${path}: missing ${marker}`)
}

const protectedMutations = [
  'app/api/drafts/[kind]/route.js',
  'app/api/geocode/route.js',
  'app/api/discovery/action/route.js',
  'app/api/date-match/start/route.js',
  'app/api/date-match/action/route.js',
  'app/api/notifications/route.js',
  'app/api/push/subscriptions/route.js',
  'app/api/media/upload/route.js'
]
for (const path of protectedMutations) await requireMarkers(path, ['verifyCsrf', 'enforceRateLimit'])

const adminApis = tracked.filter((path) => path.startsWith('app/api/admin/') && path.endsWith('/route.js'))
for (const path of adminApis) {
  const value = await source(path)
  await requireMarkers(path, ['requirePrivilegedApi'], value)
  if (/export\s+async\s+function\s+(?:POST|PUT|PATCH|DELETE)\b/.test(value)) await requireMarkers(path, ['verifyCsrf', 'enforceRateLimit'], value)
}

const adminPages = tracked.filter((path) => (path === 'app/admin/page.js' || (path.startsWith('app/admin/') && path.endsWith('/page.js'))))
for (const path of adminPages) await requireMarkers(path, ['requirePrivileged'])

await requireMarkers('app/api/stripe/webhook/route.js', ['verifyStripeWebhook', 'storeStripeWebhookEvent'])
await requireMarkers('lib/auth/privileged.js', ['privileged_access_v1', 'getAuthenticatorAssuranceLevel', "currentLevel === 'aal2'"])
await requireMarkers('lib/media/pipeline.js', ['detectedMime', 'declared !== mime', 'limitInputPixels', 'pdfLooksSafe', '/encrypt'])
await requireMarkers('tests/e2e/support.mjs', ["from 'node:crypto'", 'randomUUID'])

const testScripts = tracked.filter((path) => path.startsWith('tests/') && /\.(?:[cm]?js|jsx|ts|tsx)$/.test(path))
for (const path of testScripts) {
  const value = await source(path)
  if (/\bMath\.random\s*\(/.test(value)) findings.push(`${path}: use cryptographic test identifiers instead of Math.random()`)
}

const proxy = await source('proxy.js')
for (const marker of ['hasSupabaseAuthCookie', 'needsSession', 'publicNoSessionPaths', 'sec-fetch-site', 'content-length']) if (!proxy.includes(marker)) findings.push(`proxy.js: missing ${marker}`)
const lookup = proxy.indexOf('await updateSession(request, requestHeaders)')
const gate = proxy.indexOf('if (!needsSession)')
if (gate < 0 || lookup < 0 || gate > lookup) findings.push('proxy.js: Supabase session lookup is not gated')

if (findings.length) throw new Error(`Security surface audit failed:\n${findings.map((item) => `- ${item}`).join('\n')}`)
console.log(`Security surface audit passed for ${protectedMutations.length} interactive routes, ${adminApis.length} admin APIs, ${adminPages.length} admin pages, and ${testScripts.length} test scripts.`)
