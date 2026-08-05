import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowPath = new URL('../../.github/workflows/us-canada-catalogue-audit.yml', import.meta.url)

test('inactive catalogue audit is read-only and cannot activate production', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /default: us-ca-cities-2026-08-05-catalogue-01/)
  assert.match(workflow, /check-launch-budgets\.mjs --phase=audit/)
  assert.match(workflow, /locations:catalogue:audit[\s\S]*--fail-on-incomplete/)
  assert.match(workflow, /No catalogue manifest was published and production was not activated/)
  assert.doesNotMatch(workflow, /locations:catalogue:publish-b2/)
  assert.doesNotMatch(workflow, /--apply/)
  assert.doesNotMatch(workflow, /environment:\s*production/)
})

test('inactive catalogue audit preserves free-tier ceilings and has a bounded trigger', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /B2_LAUNCH_MAX_BYTES: '9000000000'/)
  assert.match(workflow, /SUPABASE_LAUNCH_MAX_BYTES: '400000000'/)
  assert.match(workflow, /paths:[\s\S]*us-canada-catalogue-audit\.yml/)
  assert.match(workflow, /\[audit-inactive-catalogue\]/)
  assert.match(workflow, /cancel-in-progress: false/)
})
