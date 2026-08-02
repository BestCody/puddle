import { readFile, writeFile } from 'node:fs/promises'

const statePath = process.env.PHOTO_ENRICH_FIXTURE_STATE
const mode = String(process.env.PHOTO_ENRICH_FIXTURE_MODE || 'drain')
const limit = Number(process.argv.find((value) => value.startsWith('--limit='))?.split('=')[1] || 1)
if (!statePath) throw new Error('PHOTO_ENRICH_FIXTURE_STATE is required.')

let iteration = 0
try { iteration = Number(await readFile(statePath, 'utf8')) || 0 } catch {}
iteration += 1
await writeFile(statePath, String(iteration))

if (mode === 'invalid') {
  console.log('not a photo importer summary')
  process.exit(0)
}
if (mode === 'failure') {
  console.error('simulated provider outage')
  process.exit(2)
}

const claimLimit = mode === 'reduced' ? Math.min(2, limit) : limit
const inspected = mode === 'full' || iteration === 1 ? claimLimit : Math.min(1, claimLimit)
const imported = Math.min(1, inspected)
const summary = {
  mode: 'apply',
  regionId: null,
  claimLimit,
  inspected,
  matched: imported,
  imported,
  noMatch: Math.max(0, inspected - imported),
  failed: 0,
  skipped: 0,
  minimumScore: 0.76
}
console.log(JSON.stringify(summary, null, 2))
