import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const findings = []

async function source(path) { return readFile(join(root, path), 'utf8') }
async function requireMarkers(path, markers) {
  const value = await source(path)
  for (const marker of markers) if (!value.includes(marker)) findings.push(`${path}: missing ${marker}`)
}

const protectedMutations = [
  'app/api/drafts/[kind]/route.js',
  'app/api/geocode/route.js',
  'app/api/discovery/action/route.js',
  'app/api/media/upload/route.js'
]
for (const path of protectedMutations) await requireMarkers(path, ['verifyCsrf', 'enforceRateLimit'])

const adminApis = execFileSync('git', ['ls-files', '-z', 'app/api/admin/**/route.js'], { cwd: root }).toString().split('\0').filter(Boolean)
for (const path of adminApis) await requireMarkers(path, ['requirePrivilegedApi', 'verifyCsrf', 'enforceRateLimit'])

const adminPages = execFileSync('git', ['ls-files', '-z', 'app/admin/**/page.js', 'app/admin/page.js'], { cwd: root }).toString().split('\0').filter(Boolean)
for (const path of adminPages) await requireMarkers(path, ['requirePrivileged'])

await requireMarkers('app/api/stripe/webhook/route.js', ['verifyStripeWebhook', 'storeStripeWebhookEvent'])
await requireMarkers('lib/auth/privileged.js', ['privileged_access_v1', 'getAuthenticatorAssuranceLevel', "currentLevel === 'aal2'"])
await requireMarkers('lib/media/pipeline.js', ['detectedMime', 'declared !== mime', 'limitInputPixels', 'pdfLooksSafe', '/encrypt'])

const proxy = await source('proxy.js')
for (const marker of ['hasSupabaseAuthCookie', 'needsSession', 'publicNoSessionPaths', 'sec-fetch-site', 'content-length']) if (!proxy.includes(marker)) findings.push(`proxy.js: missing ${marker}`)
const lookup = proxy.indexOf('await updateSession(request, requestHeaders)')
const gate = proxy.indexOf('if (!needsSession)')
if (gate < 0 || lookup < 0 || gate > lookup) findings.push('proxy.js: Supabase session lookup is not gated')

if (findings.length) throw new Error(`Security surface audit failed:\n${findings.map((item) => `- ${item}`).join('\n')}`)
console.log(`Security surface audit passed for ${protectedMutations.length} interactive routes, ${adminApis.length} admin APIs, and ${adminPages.length} admin pages.`)
