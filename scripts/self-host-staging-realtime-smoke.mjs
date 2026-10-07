import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { validateStagingAuthSmokeEnv } from './self-host-staging-auth-smoke.mjs'

export function subscribed(channel) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Staging Realtime subscription timed out')), 15_000)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout)
        resolve()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        clearTimeout(timeout)
        reject(new Error(`Staging Realtime subscription failed: ${status}`))
      }
    })
  })
}

export async function runStagingRealtimeSmoke(env = process.env) {
  const { auth } = validateStagingAuthSmokeEnv(env)
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  const sender = createClient(auth, env.PUDDLE_STAGING_SERVICE_KEY, options)
  const receiver = createClient(auth, env.PUDDLE_STAGING_SERVICE_KEY, options)
  const topic = `staging-smoke-${randomUUID()}`
  const nonce = randomUUID()
  const sendingChannel = sender.channel(topic, { config: { broadcast: { self: false } } })
  let resolveEvent
  const received = new Promise((resolve) => { resolveEvent = resolve })
  const receivingChannel = receiver.channel(topic, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'ping' }, ({ payload }) => {
      if (payload?.nonce === nonce) resolveEvent(payload)
    })
  try {
    await Promise.all([subscribed(sendingChannel), subscribed(receivingChannel)])
    const sent = await sendingChannel.send({ type: 'broadcast', event: 'ping', payload: { nonce } })
    assert.equal(sent, 'ok', 'The sender must publish the staging event')
    const observed = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Staging Realtime event did not arrive')), 15_000)
      received.then((value) => {
        clearTimeout(timeout)
        resolve(value)
      })
    })
    assert.equal(observed.nonce, nonce)
    process.stdout.write('Staging Realtime subscription and cross-client broadcast passed.\n')
  } finally {
    await Promise.allSettled([sender.removeChannel(sendingChannel), receiver.removeChannel(receivingChannel)])
    await Promise.allSettled([sender.realtime.disconnect(), receiver.realtime.disconnect()])
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStagingRealtimeSmoke().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
