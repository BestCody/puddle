import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { validateStagingAuthSmokeEnv } from './self-host-staging-auth-smoke.mjs'

function cookieHeader(response) {
  return response.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; ')
}

export async function runStagingMediaUploadSmoke(env = process.env) {
  const { app, auth, site } = validateStagingAuthSmokeEnv(env)
  const admin = createClient(auth, env.PUDDLE_STAGING_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
  const email = `puddle-media-smoke-${randomUUID()}@example.invalid`
  const password = randomBytes(36).toString('base64url')
  let userId
  let failure
  try {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    assert.equal(created.error, null)
    userId = created.data.user.id
    const login = await fetch(`${app}/api/auth/password`, {
      method: 'POST', body: new URLSearchParams({ email, password }),
      redirect: 'manual', signal: AbortSignal.timeout(15_000)
    })
    assert.equal(login.status, 303)
    const loginCookie = cookieHeader(login)
    assert.ok(loginCookie)
    const csrf = await fetch(`${app}/api/security/csrf`, {
      headers: { cookie: loginCookie }, signal: AbortSignal.timeout(15_000)
    })
    assert.equal(csrf.status, 200)
    const { token } = await csrf.json()
    assert.ok(token)
    const csrfCookie = cookieHeader(csrf)
    assert.ok(csrfCookie)

    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#efc850' } })
      .png().toBuffer()
    const form = new FormData()
    form.set('purpose', 'profile_photo')
    form.set('file', new Blob([image], { type: 'image/png' }), 'staging-smoke.png')
    const upload = await fetch(`${app}/api/media/upload`, {
      method: 'POST',
      headers: { origin: site, cookie: `${loginCookie}; ${csrfCookie}`, 'x-puddle-csrf': token },
      body: form, signal: AbortSignal.timeout(30_000)
    })
    const result = await upload.json()
    assert.equal(upload.status, 201, `Staging app upload failed: ${result.error || upload.status}`)
    assert.ok(result.asset?.id)

    const asset = await admin.from('media_assets').select('id,bucket_id,object_path,sha256')
      .eq('id', result.asset.id).eq('owner_id', userId).single()
    assert.equal(asset.error, null)
    const stored = await admin.storage.from(asset.data.bucket_id).download(asset.data.object_path)
    assert.equal(stored.error, null)
    const storedHash = createHash('sha256').update(Buffer.from(await stored.data.arrayBuffer())).digest('hex')
    assert.equal(storedHash, asset.data.sha256)
    const profile = await admin.from('profiles').select('avatar_path').eq('id', userId).single()
    assert.equal(profile.error, null)
    assert.equal(profile.data.avatar_path, asset.data.object_path)
    process.stdout.write('Staging app profile upload, canonical bytes, and profile attachment passed.\n')
  } catch (error) {
    failure = error
  } finally {
    if (userId) {
      const assets = await admin.from('media_assets').select('id,bucket_id,object_path').eq('owner_id', userId)
      if (assets.error) {
        const cleanup = new Error(`Disposable media audit failed: ${assets.error.message}`)
        failure = failure ? new AggregateError([failure, cleanup], 'Media smoke and cleanup failed') : cleanup
      } else {
        for (const asset of assets.data || []) {
          const detached = await admin.from('profiles').update({ avatar_path: null }).eq('id', userId)
          const removed = await admin.storage.from(asset.bucket_id).remove([asset.object_path])
          const deleted = await admin.from('media_assets').delete().eq('id', asset.id).eq('owner_id', userId)
          for (const [label, operation] of [['detach', detached], ['object removal', removed], ['asset removal', deleted]]) {
            if (operation.error) {
              const cleanup = new Error(`Disposable media ${label} failed: ${operation.error.message}`)
              failure = failure ? new AggregateError([failure, cleanup], 'Media smoke and cleanup failed') : cleanup
            }
          }
        }
      }
      const deletedUser = await admin.auth.admin.deleteUser(userId)
      if (deletedUser.error) {
        const cleanup = new Error(`Disposable account cleanup failed: ${deletedUser.error.message}`)
        failure = failure ? new AggregateError([failure, cleanup], 'Media smoke and cleanup failed') : cleanup
      }
    }
  }
  if (failure) throw failure
  process.stdout.write('Disposable staging account and media removed.\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStagingMediaUploadSmoke().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
