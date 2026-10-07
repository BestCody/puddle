import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareObjectInventories, validateObjectMigrationEnv } from '../../scripts/self-host-migrate-objects.mjs'

test('restored host alone relabels canonical media and removes retired source credentials', () => {
  const sql = readFileSync(new URL('../../deploy/self-host/object-backend-cutover.sql', import.meta.url), 'utf8')
  const guide = readFileSync(new URL('../../deploy/self-host/README.md', import.meta.url), 'utf8')
  assert.match(sql, /update public\.media_objects\s+set storage_backend='object_store'/)
  assert.match(sql, /check \(storage_backend = 'object_store'\)/)
  assert.match(sql, /drop function if exists public\.get_b2_data_runtime_auth\(\)/)
  assert.match(sql, /delete from vault\.secrets/)
  assert.match(guide, /after inventory reconciliation/i)
  assert.match(guide, /restored self-host database only/)
})

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

test('object migration verifies source and local S3 endpoints before copying', () => {
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
    writeFileSync(config, '[source]\ntype = s3\nendpoint = https://source.example.com\n[target]\ntype = s3\nendpoint = http://127.0.0.1:8333\n', { mode: 0o600 })
    assert.deepEqual(validateObjectMigrationEnv(env), [])
    writeFileSync(config, '[source]\ntype = s3\nendpoint = https://source.example.com\n[target]\ntype = s3\nendpoint = https://source.example.com\n')
    assert.match(validateObjectMigrationEnv(env).join(' '), /loopback-only object endpoint/)
    writeFileSync(config, '[source]\ntype = s3\nendpoint = http://127.0.0.1:8333\n[target]\ntype = s3\nendpoint = http://127.0.0.1:8333\n')
    assert.match(validateObjectMigrationEnv(env).join(' '), /HTTPS endpoint/)
    env.PUDDLE_TARGET_OBJECT_REMOTE = 'target:wrong-bucket'
    assert.match(validateObjectMigrationEnv(env).join(' '), /bucket names must match OBJECT_STORAGE_BUCKET/)
    env.RCLONE_CONFIG_TARGET_ENDPOINT = 'https://source.example.com'
    assert.match(validateObjectMigrationEnv(env).join(' '), /RCLONE_CONFIG_\*/)
    delete env.RCLONE_CONFIG_TARGET_ENDPOINT
    env.RCLONE_S3_ENDPOINT = 'https://source.example.com'
    assert.match(validateObjectMigrationEnv(env).join(' '), /RCLONE_S3_\*/)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('reboot recovery resumes only the non-deleting copy and never marks an interrupted transfer complete', () => {
  const unit = readFileSync(new URL('../../deploy/self-host/puddle-object-copy-resume.service', import.meta.url), 'utf8')
  assert.match(unit, /ConditionPathExists=!\/root\/\.config\/puddle\/object-copy-complete/)
  assert.match(unit, /EnvironmentFile=\/root\/\.config\/puddle\/migration\.env/)
  assert.match(unit, /ExecStart=\/usr\/bin\/rclone copy --config \$\{RCLONE_CONFIG\}/)
  assert.match(unit, /\$\{PUDDLE_SOURCE_OBJECT_REMOTE\} \$\{PUDDLE_TARGET_OBJECT_REMOTE\}/)
  assert.match(unit, /ExecStartPost=\/usr\/bin\/touch \/root\/\.config\/puddle\/object-copy-complete/)
  assert.match(unit, /Restart=on-failure/)
  assert.doesNotMatch(unit, /OnSuccess=puddle-object-migration\.service/)
  assert.doesNotMatch(unit, /rclone (?:sync|delete)/)
})

test('manual migration compares inventories without downloading source objects again', () => {
  const unit = readFileSync(new URL('../../deploy/self-host/puddle-object-migration.service', import.meta.url), 'utf8')
  assert.match(unit, /ExecStart=\/usr\/bin\/node \/opt\/puddle-stage\/self-host-migrate-objects\.mjs/)
  assert.match(unit, /After=.*puddle-object-copy-resume\.service/)
  assert.match(unit, /ConditionPathExists=\/root\/\.config\/puddle\/object-copy-complete/)
  assert.match(unit, /ConditionPathExists=!\/root\/\.config\/puddle\/object-inventory-checked/)
  assert.match(unit, /ExecStartPost=\/usr\/bin\/touch \/root\/\.config\/puddle\/object-inventory-checked/)
  assert.match(unit, /MemoryMax=4G/)
  assert.doesNotMatch(unit, /WantedBy=multi-user\.target/)
  const script = readFileSync(new URL('../../scripts/self-host-migrate-objects.mjs', import.meta.url), 'utf8')
  assert.equal((script.match(/'lsjson', \.\.\.base, '--recursive', '--fast-list', '--files-only', '--no-mimetype', '--no-modtime'/g) || []).length, 2)
  assert.doesNotMatch(script, /--download/)
  assert.match(script, /inventory-checked\.json/)
  assert.doesNotMatch(script, /'sync'|'delete'/)
})

test('local inventory comparison detects missing, extra and wrong-sized objects', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'puddle-object-inventory-'))
  const source = join(scratch, 'source.json')
  const target = join(scratch, 'target.json')
  try {
    writeFileSync(source, JSON.stringify([
      { Path: 'a', Size: 2, IsDir: false },
      { Path: 'b', Size: 3, IsDir: false },
      { Path: 'c', Size: 4, IsDir: false }
    ]))
    writeFileSync(target, JSON.stringify([
      { Path: 'a', Size: 2, IsDir: false },
      { Path: 'b', Size: 1, IsDir: false },
      { Path: 'd', Size: 5, IsDir: false }
    ]))
    const result = compareObjectInventories(source, target)
    assert.equal(result.ok, false)
    assert.equal(result.missingCount, 1)
    assert.equal(result.unexpectedCount, 1)
    assert.equal(result.sizeMismatchCount, 1)
    writeFileSync(target, readFileSync(source))
    assert.equal(compareObjectInventories(source, target).ok, true)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
