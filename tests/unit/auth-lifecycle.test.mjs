import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { authLinkErrorMessage, isDuplicateUsernameError, profileWriteErrorMessage, safeAuthErrorCode } from '../../lib/auth/errors.js'
import { authenticatedDestination } from '../../lib/auth/profile.js'

test('expired and reused authentication links receive a useful message', () => {
  assert.match(authLinkErrorMessage('otp_expired'), /expired|already been used/i)
  assert.match(authLinkErrorMessage('otp_disabled'), /expired|already been used/i)
  assert.doesNotMatch(authLinkErrorMessage('otp_expired'), /supabase|database|token hash/i)
})

test('unsafe provider error values are reduced to diagnostic codes', () => {
  assert.equal(safeAuthErrorCode('Bad Code Verifier<script>'), 'badcodeverifierscript')
  assert.equal(safeAuthErrorCode('', 'callback_failed'), 'callback_failed')
})

test('duplicate usernames map to a user-facing recovery message', () => {
  const error = { code: '23505', message: 'duplicate key value violates unique constraint "profiles_username_key"' }
  assert.equal(isDuplicateUsernameError(error), true)
  assert.match(profileWriteErrorMessage(error), /username is already taken/i)
})

test('new or recovered profiles are always sent through onboarding', () => {
  assert.equal(authenticatedDestination(null, '/dashboard'), '/onboarding')
  assert.equal(authenticatedDestination({ onboarding_completed_at: null }, '/create'), '/onboarding')
  assert.equal(authenticatedDestination({ onboarding_completed_at: '2026-01-01T00:00:00Z' }, '/onboarding'), '/dashboard')
  assert.equal(authenticatedDestination({ onboarding_completed_at: '2026-01-01T00:00:00Z' }, '/create'), '/create')
})

test('password recovery is allowed before onboarding is complete', () => {
  assert.equal(authenticatedDestination(null, '/update-password'), '/update-password')
})

test('authenticated and service API roles receive required database privileges', async () => {
  const migration = await readFile(new URL('../../supabase/migrations/0025_api_role_privileges.sql', import.meta.url), 'utf8')
  assert.match(migration, /grant select, insert, update on table public\.profiles to authenticated/i)
  assert.match(migration, /grant all privileges on all tables in schema public to service_role/i)
  assert.match(migration, /alter default privileges in schema public grant all privileges on tables to service_role/i)
})
