import test from 'node:test'
import assert from 'node:assert/strict'
import { validateObjectMigrationEnv } from '../../scripts/self-host-migrate-objects.mjs'

test('object migration fails closed without a private rclone config and distinct bucket roots', () => {
  const problems = validateObjectMigrationEnv({
    RCLONE_CONFIG: '',
    PUDDLE_SOURCE_OBJECT_REMOTE: 'source:puddle-assets/data',
    PUDDLE_TARGET_OBJECT_REMOTE: 'source:puddle-assets/data',
    PUDDLE_MIGRATION_REPORT_DIR: '/'
  })
  assert.ok(problems.some((problem) => problem.includes('RCLONE_CONFIG')))
  assert.ok(problems.some((problem) => problem.includes('PUDDLE_SOURCE_OBJECT_REMOTE')))
  assert.ok(problems.some((problem) => problem.includes('PUDDLE_TARGET_OBJECT_REMOTE')))
  assert.ok(problems.some((problem) => problem.includes('PUDDLE_MIGRATION_REPORT_DIR')))
})
