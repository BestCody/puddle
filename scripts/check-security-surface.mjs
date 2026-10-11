import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const findings = []

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

await requireMarkers('lib/media/pipeline.js', ['detectedMime', 'declared !== mime', 'limitInputPixels', 'pdfLooksSafe', '/encrypt'])
await requireMarkers('app/api/open-photo/[sha256]/route.js', ['actualHash !== hash', 'canonicalStorageKey'])

const proxy = await source('proxy.js')
for (const marker of ['hasSupabaseAuthCookie', 'needsSession', 'publicNoSessionPaths', 'sec-fetch-site', 'content-length', "'/matches'"]) if (!proxy.includes(marker)) findings.push(`proxy.js: missing ${marker}`)
const lookup = proxy.indexOf('await updateSession(request, requestHeaders')
const gate = proxy.indexOf('if (!needsSession)')
if (gate < 0 || lookup < 0 || gate > lookup) findings.push('proxy.js: Supabase session lookup is not gated')

if (findings.length) throw new Error(`Security surface audit failed:\n${findings.map((item) => `- ${item}`).join('\n')}`)
console.log(`Security surface audit passed for ${protectedMutations.length} interactive routes and the upload/session boundaries.`)
