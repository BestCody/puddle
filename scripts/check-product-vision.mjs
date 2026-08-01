import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const required = [
  'lib/product-vision.js',
  'lib/app/location-plans-data.js',
  'app/plans/legacy-page.js',
  'tests/unit/product-vision.test.mjs',
  'docs/LOCATION_FIRST_CUTOVER.md'
]

for (const path of required) await access(join(root, path))

const read = (path) => readFile(join(root, path), 'utf8')
const requireIncludes = (source, markers, label) => {
  for (const marker of markers) if (!source.includes(marker)) throw new Error(`${label} is missing ${marker}`)
}

const env = await read('.env.example')
requireIncludes(env, ['PUDDLE_LEGACY_SYSTEMS_ENABLED=false'], 'Environment defaults')

const vision = await read('lib/product-vision.js')
for (const marker of [
  '/events',
  '/studio/events',
  '/friends',
  '/inbox',
  '/wallet',
  '/orders',
  '/admin/finance',
  '/api/stripe',
  '/api/location-sharing',
  '/api/plans',
  '/api/ai/assist'
]) if (!vision.includes(marker)) throw new Error(`Product vision gate is missing ${marker}`)
requireIncludes(vision, ['/studio/places/123'], 'Location contribution exception test coverage')

const proxy = await read('proxy.js')
requireIncludes(proxy, ['legacySystemsEnabled()', 'legacyRedirectForPath(pathname)', 'isLegacyApiPath(pathname)', 'status: 410'], 'Runtime legacy gate')

const plans = await read('app/plans/page.js')
requireIncludes(plans, ['getLocationPlansSnapshot', "['saved', 'Saved']", "['planned', 'Planned']", "['past', 'Past']", 'LegacyPlansPage'], 'Location-only plans')

const drafts = await read('app/api/drafts/[kind]/route.js')
requireIncludes(drafts, ["kind === 'event' && !legacySystemsEnabled()", 'Event creation is disabled'], 'Event draft guard')

const createActions = await read('app/create/actions.js')
requireIncludes(createActions, ['requireLegacyEventSystem()', 'Event creation is no longer part'], 'Event server-action guard')

const planActions = await read('app/plans/actions.js')
requireIncludes(planActions, ['requireLegacyPlansSystem()', 'Complex itineraries and event attendance are disabled'], 'Legacy plans server-action guard')

const admin = await read('components/admin-shell.js')
requireIncludes(admin, ['coreLinks', 'legacyLinks', 'legacySystemsEnabled()'], 'Admin navigation gate')

console.log('Puddle location-first cutover checks passed.')
