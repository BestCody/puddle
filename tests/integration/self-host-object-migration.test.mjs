import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

test('object migration verifies actual B2 and local S3 endpoints before copying', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'puddle-object-migration-'))
  const config = join(scratch, 'rclone.conf')
  const env = {
    RCLONE_CONFIG: config,
    OBJECT_STORAGE_BUCKET: 'puddle-assets',
    PUDDLE_SOURCE_OBJECT_REMOTE: 'source:puddle-assets',
    PUDDLE_TARGET_OBJECT_REMOTE: 'target:puddle-assets',
    PUDDLE_MIGRATION_REPORT_DIR: join(scratch, 'reports')
  }
  try {
    writeFileSync(config, '[source]\ntype = s3\nendpoint = https://s3.us-east-005.backblazeb2.com\n[target]\ntype = s3\nendpoint = http://127.0.0.1:8333\n', { mode: 0o600 })
    assert.deepEqual(validateObjectMigrationEnv(env), [])
    writeFileSync(config, '[source]\ntype = s3\nendpoint = https://s3.us-east-005.backblazeb2.com\n[target]\ntype = s3\nendpoint = https://s3.us-east-005.backblazeb2.com\n')
    assert.match(validateObjectMigrationEnv(env).join(' '), /loopback-only object endpoint/)
    writeFileSync(config, '[source]\ntype = s3\nendpoint = http://127.0.0.1:8333\n[target]\ntype = s3\nendpoint = http://127.0.0.1:8333\n')
    assert.match(validateObjectMigrationEnv(env).join(' '), /HTTPS Backblaze B2 endpoint/)
    env.PUDDLE_TARGET_OBJECT_REMOTE = 'target:wrong-bucket'
    assert.match(validateObjectMigrationEnv(env).join(' '), /bucket names must match OBJECT_STORAGE_BUCKET/)
    env.RCLONE_CONFIG_TARGET_ENDPOINT = 'https://s3.us-east-005.backblazeb2.com'
    assert.match(validateObjectMigrationEnv(env).join(' '), /RCLONE_CONFIG_\*/)
    delete env.RCLONE_CONFIG_TARGET_ENDPOINT
    env.RCLONE_S3_ENDPOINT = 'https://s3.us-east-005.backblazeb2.com'
    assert.match(validateObjectMigrationEnv(env).join(' '), /RCLONE_S3_\*/)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
