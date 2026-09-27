import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SUPABASE_COMMIT, SUPABASE_RELEASE, validateInstallDestination } from '../../scripts/self-host-install-supabase.mjs'

test('self-host Supabase installer pins one official release and rejects broad targets', () => {
  assert.match(SUPABASE_RELEASE, /^self-hosted\/v\d+\.\d+\.\d+$/)
  assert.match(SUPABASE_COMMIT, /^[a-f0-9]{40}$/)
  assert.throws(() => validateInstallDestination('.'), /absolute/)
  assert.throws(() => validateInstallDestination(tmpdir()), /too broad/)
})

test('self-host Supabase installer never overwrites an existing target', () => {
  const existing = mkdtempSync(join(tmpdir(), 'puddle-supabase-test-'))
  try {
    assert.throws(() => validateInstallDestination(existing), /already exists/)
  } finally {
    rmSync(existing, { recursive: true })
  }
})
