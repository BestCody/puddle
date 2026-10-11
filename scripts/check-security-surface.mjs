import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
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
  'app/api/location/reverse/route.js',
  'app/api/discovery/actions/route.js',
  'app/api/social/share-location/route.js',
  'app/api/media/upload/route.js',
  'app/api/discovery/route.js',
  'app/api/recommendations/preferences/route.js',
  'app/api/saved-location/[slug]/route.js'
]
for (const path of protectedMutations) await requireMarkers(path, ['verifyCsrf', 'enforceRateLimit'])
await requireMarkers('app/api/discovery/actions/route.js', ['MAX_ACTIONS = 20', 'record_discovery_actions_v4'])
await requireMarkers('app/api/social/share-location/route.js', ['send_location_to_friend_v1'])

for (const path of tracked.filter((name) => name.startsWith('app/admin/') || name.startsWith('app/api/admin/'))) {
  if (existsSync(join(root, path))) findings.push(`${path}: retired admin route is still mounted`)
}
await requireMarkers('lib/media/pipeline.js', ['detectedMime', 'declared !== mime', 'limitInputPixels', 'pdfLooksSafe', '/encrypt'])
await requireMarkers('tests/e2e/support.mjs', ["from 'node:crypto'", 'randomUUID'])

const testScripts = tracked.filter((path) => path.startsWith('tests/') && /\.(?:[cm]?js|jsx|ts|tsx)$/.test(path))
for (const path of testScripts) {
  let value
  try {
    value = await source(path)
  } catch (error) {
    // A deleted tracked test remains in the index until the refactor is staged.
    if (error?.code === 'ENOENT') continue
    throw error
  }
  if (/\bMath\.random\s*\(/.test(value)) findings.push(`${path}: use cryptographic test identifiers instead of Math.random()`)
}

const proxy = await source('proxy.js')
for (const marker of ['hasSupabaseAuthCookie', 'needsSession', 'publicNoSessionPaths', 'sec-fetch-site', 'content-length', "'/matches'"]) if (!proxy.includes(marker)) findings.push(`proxy.js: missing ${marker}`)
const lookup = proxy.indexOf('await updateSession(request, requestHeaders')
const gate = proxy.indexOf('if (!needsSession)')
if (gate < 0 || lookup < 0 || gate > lookup) findings.push('proxy.js: Supabase session lookup is not gated')

if (findings.length) throw new Error(`Security surface audit failed:\n${findings.map((item) => `- ${item}`).join('\n')}`)
console.log(`Security surface audit passed for ${protectedMutations.length} interactive routes, no mounted admin routes, and ${testScripts.length} test scripts.`)
