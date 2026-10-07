import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { stagingCatalogueOrigin } from './self-host-staging-catalogue-smoke.mjs'

export async function runStagingPhotoSmoke(env = process.env) {
  const origin = stagingCatalogueOrigin(env)
  const hash = String(env.PUDDLE_STAGING_PHOTO_SHA256 || '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('PUDDLE_STAGING_PHOTO_SHA256 must be a canonical SHA-256 hash')
  const response = await fetch(`${origin}/api/open-photo/${hash}`, { signal: AbortSignal.timeout(30_000) })
  assert.equal(response.status, 200, 'A copied canonical photo must load through the app')
  assert.match(response.headers.get('content-type') || '', /^image\/jpeg\b/)
  const body = Buffer.from(await response.arrayBuffer())
  assert.ok(body.length > 0 && body.length <= 10_000_000, 'A canonical photo must have bounded content')
  assert.equal(createHash('sha256').update(body).digest('hex'), hash, 'Delivered photo bytes must match their canonical hash')
  process.stdout.write('Staging canonical photo delivery and SHA-256 verification passed.\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStagingPhotoSmoke().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
