import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowPath = new URL('../../.github/workflows/us-canada-catalogue-audit.yml', import.meta.url)
const structuralAuditPath = new URL('../../scripts/audit-static-catalogue-structure.mjs', import.meta.url)

test('inactive catalogue audit is read-only and cannot activate production', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /default: us-ca-cities-2026-08-05-catalogue-01/)
  assert.match(workflow, /check-launch-budgets\.mjs --phase=audit/)
  assert.match(workflow, /audit-static-catalogue-structure\.mjs[\s\S]*--fail-on-incomplete/)
  assert.match(workflow, /locations:catalogue:audit[\s\S]*--fail-on-incomplete/)
  assert.match(workflow, /if: \$\{\{ env\.AUDIT_MODE == 'full' \}\}/)
  assert.match(workflow, /No catalogue manifest was published and production was not activated/)
  assert.doesNotMatch(workflow, /locations:catalogue:publish-b2/)
  assert.doesNotMatch(workflow, /--apply/)
  assert.doesNotMatch(workflow, /environment:\s*production/)
})

test('inactive catalogue audit preserves free-tier ceilings and has a bounded trigger', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /B2_LAUNCH_MAX_BYTES: '9000000000'/)
  assert.match(workflow, /SUPABASE_LAUNCH_MAX_BYTES: '400000000'/)
  assert.match(workflow, /default: structure/)
  assert.match(workflow, /AUDIT_MODE: \$\{\{ inputs\.mode \|\| 'structure' \}\}/)
  assert.match(workflow, /paths:[\s\S]*us-canada-catalogue-audit\.yml[\s\S]*audit-static-catalogue-structure\.mjs/)
  assert.match(workflow, /\[audit-inactive-catalogue\]/)
  assert.match(workflow, /cancel-in-progress: false/)
})

test('structural audit uses listings and verifies all catalogue tile families', async () => {
  const script = await readFile(structuralAuditPath, 'utf8')

  assert.match(script, /listAllB2Objects/)
  assert.match(script, /const families = \['tiles', 'details', 'provenance'\]/)
  assert.match(script, /releaseManifestPresent/)
  assert.match(script, /missingCompanionCount/)
  assert.match(script, /zeroByteObjectCount/)
  assert.match(script, /estimatedFullAuditClassBReads/)
  assert.match(script, /does not download or parse catalogue JSON/)
  assert.doesNotMatch(script, /b2Request/)
  assert.doesNotMatch(script, /putB2Object|deleteB2Object|--apply/)
})
