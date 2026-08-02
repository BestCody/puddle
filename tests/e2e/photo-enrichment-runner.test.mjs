import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = fileURLToPath(new URL('../..', import.meta.url))
const runner = join(root, 'scripts/enrich-open-location-photos.mjs')
const importer = join(root, 'tests/fixtures/fake-photo-importer.mjs')

async function runWorker(mode, overrides = {}) {
  const work = await mkdtemp(join(tmpdir(), 'puddle-photo-runner-'))
  const state = join(work, 'state.txt')
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner], {
      cwd: root,
      env: {
        ...process.env,
        PHOTO_ENRICH_IMPORTER: importer,
        PHOTO_ENRICH_FIXTURE_STATE: state,
        PHOTO_ENRICH_FIXTURE_MODE: mode,
        PHOTO_ENRICH_BATCH_SIZE: '3',
        PHOTO_ENRICH_MAX_BATCHES: '5',
        PHOTO_ENRICH_MAX_RUNTIME_MINUTES: '5',
        ...overrides
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
  let iterations = 0
  try { iterations = Number(await readFile(state, 'utf8')) || 0 } catch {}
  await rm(work, { recursive: true, force: true })
  return { ...result, iterations }
}

test('progressive runner drains multiple committed batches until the queue is empty', async () => {
  const result = await runWorker('drain')
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.iterations, 2)
  assert.match(result.stdout, /"complete": true/)
  assert.match(result.stdout, /"stoppedReason": "queue_drained"/)
  assert.match(result.stdout, /"inspected": 5/)
})

test('progressive runner stops cleanly at its batch ceiling and resumes on a later run', async () => {
  const result = await runWorker('full', { PHOTO_ENRICH_MAX_BATCHES: '2' })
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.iterations, 2)
  assert.match(result.stdout, /"complete": false/)
  assert.match(result.stdout, /"stoppedReason": "max_batches"/)
  assert.match(result.stdout, /"inspected": 6/)
})

test('progressive runner fails closed when an importer summary is malformed', async () => {
  const result = await runWorker('invalid')
  assert.equal(result.code, 1)
  assert.match(result.stderr, /did not return a readable summary/)
})

test('progressive runner propagates systemic importer failures instead of spinning', async () => {
  const result = await runWorker('failure')
  assert.equal(result.code, 1)
  assert.equal(result.iterations, 1)
  assert.match(result.stderr, /Photo importer failed with exit code 2/)
})
