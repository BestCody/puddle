import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { validateStagingAuthSmokeEnv } from './self-host-staging-auth-smoke.mjs'

export async function deleteStagingDisposableUser(env = process.env) {
  const { auth } = validateStagingAuthSmokeEnv(env)
  const id = String(env.PUDDLE_STAGING_DELETE_USER_ID || '')
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  const admin = createClient(auth, env.PUDDLE_STAGING_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
  const lookup = await admin.auth.admin.getUserById(id)
  if (lookup.error || !lookup.data?.user) throw new Error('Disposable staging account was not found')
  assert.match(lookup.data.user.email || '', /^puddle-[a-z-]+-smoke-[0-9a-f-]+@example\.invalid$/i)
  const deleted = await admin.auth.admin.deleteUser(id)
  if (deleted.error) throw new Error(`Disposable staging account cleanup failed: ${deleted.error.message}`)
  process.stdout.write('Verified disposable staging account deleted.\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  deleteStagingDisposableUser().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
