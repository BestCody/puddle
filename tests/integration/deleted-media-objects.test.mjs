import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { processDeletedMediaObjects } from '../../lib/media/deleted-object-worker.js'

function adminFor({ removalError = null, completionData = true, completionError = null } = {}) {
  const calls = []
  const job = { id: 17, bucket_id: 'puddle-public-media', object_path: 'owner/asset/photo.webp', claim_attempt: 2 }
  return {
    calls,
    client: {
      rpc(name, args) {
        calls.push([name, args])
        if (name === 'claim_media_object_deletion_jobs_v1') return Promise.resolve({ data: [job], error: null })
        return Promise.resolve({ data: completionData, error: completionError })
      },
      storage: { from(bucket) { return { async remove(paths) { calls.push(['remove', bucket, paths]); return { error: removalError } } } } }
    }
  }
}

test('deleted media bytes are removed and completed with the current claim attempt', async () => {
  const { client, calls } = adminFor()
  assert.deepEqual(await processDeletedMediaObjects(client), [{ id: 17, ok: true, status: 'removed' }])
  assert.deepEqual(calls[1], ['remove', 'puddle-public-media', ['owner/asset/photo.webp']])
  assert.equal(calls[2][1].expected_attempt, 2)
  assert.equal(calls[2][1].succeeded, true)
})

test('storage and completion failures remain visible for retry and monitoring', async () => {
  const failed = adminFor({ removalError: new Error('storage unavailable') })
  assert.deepEqual(await processDeletedMediaObjects(failed.client), [{ id: 17, ok: false, status: 'retry_queued' }])
  assert.equal(failed.calls[2][1].succeeded, false)
  assert.equal(failed.calls[2][1].failure_reason, 'storage unavailable')

  const stale = adminFor({ completionData: false })
  assert.deepEqual(await processDeletedMediaObjects(stale.client), [{ id: 17, ok: false, status: 'stale_claim' }])

  const databaseFailure = adminFor({ completionError: new Error('database unavailable') })
  await assert.rejects(processDeletedMediaObjects(databaseFailure.client), /database unavailable/)
})

test('cleanup queue is private, trigger-backed, and scheduled on the self-hosted app', async () => {
  const [migration, route, dockerfile, service, timer, runner] = await Promise.all([
    readFile(new URL('../../supabase/migrations/20260928054823_cleanup_deleted_media_objects.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../app/api/security/media-objects/process/route.js', import.meta.url), 'utf8'),
    readFile(new URL('../../deploy/self-host/Dockerfile', import.meta.url), 'utf8'),
    readFile(new URL('../../deploy/self-host/media-objects.service', import.meta.url), 'utf8'),
    readFile(new URL('../../deploy/self-host/media-objects.timer', import.meta.url), 'utf8'),
    readFile(new URL('../../scripts/self-host-cleanup-media-objects.mjs', import.meta.url), 'utf8')
  ])
  assert.match(migration, /after delete on public\.media_assets/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /revoke all on public\.media_object_deletion_jobs from public, anon, authenticated/)
  assert.match(migration, /for update skip locked/)
  assert.match(migration, /expected_attempt/)
  assert.match(route, /verifyWorkerBearer\(request\)/)
  assert.match(route, /failed \? 503 : 200/)
  assert.match(dockerfile, /self-host-cleanup-media-objects\.mjs/)
  assert.match(service, /exec -T app node scripts\/self-host-cleanup-media-objects\.mjs/)
  assert.match(timer, /OnCalendar=\*-\*-\* \*:2\/5:00 UTC/)
  assert.match(runner, /api\/security\/media-objects\/process/)
})
