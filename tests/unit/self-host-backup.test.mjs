import test from 'node:test'
import assert from 'node:assert/strict'
import { validateBackupEnv } from '../../scripts/self-host-backup-postgres.mjs'

test('database backup refuses local or unconfigured repositories', () => {
  const problems = validateBackupEnv({
    PUDDLE_OFFSITE_BACKUP_READY: 'false',
    RESTIC_REPOSITORY: 'sftp:user@localhost:/backups',
    RESTIC_PASSWORD_FILE: '',
    SUPABASE_INSTALL_DIR: ''
  })
  assert.equal(problems.length, 4)
})
