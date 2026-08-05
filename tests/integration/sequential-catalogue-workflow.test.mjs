import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowPath = new URL('../../.github/workflows/us-canada-catalogue-sequential.yml', import.meta.url)

test('sequential catalogue build avoids remote reads and uploads only once', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /Build every market with local-only catalogue reads/)
  assert.match(workflow, /while IFS= read -r market; do/)
  assert.match(workflow, /B2_S3_ENDPOINT=''[\s\S]*locations:catalogue:build-mixed/)
  assert.doesNotMatch(workflow, /strategy:\s*\n\s+matrix:/)

  const publishCommands = workflow.match(/locations:catalogue:publish-b2/g) || []
  assert.equal(publishCommands.length, 1, 'the completed local release must be uploaded exactly once')

  const removeRootManifest = workflow.indexOf('rm "$output/catalogue/manifest.json"')
  const publishRelease = workflow.indexOf('locations:catalogue:publish-b2')
  assert.ok(removeRootManifest >= 0 && removeRootManifest < publishRelease, 'root activation manifest must be removed before upload')
  assert.match(workflow, /Production catalogue manifest was not uploaded/)
})

test('sequential catalogue build keeps the free-tier ceilings', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /B2_LAUNCH_MAX_BYTES: '9000000000'/)
  assert.match(workflow, /SUPABASE_LAUNCH_MAX_BYTES: '400000000'/)
  assert.match(workflow, /check-launch-budgets\.mjs --phase=preflight/)
  assert.match(workflow, /check-launch-budgets\.mjs[\s\S]*--phase=partition/)
  assert.doesNotMatch(workflow, /google|photo_batches|activate:\s*true/i)
})
