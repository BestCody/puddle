import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { validateStagingAuthSmokeEnv } from './self-host-staging-auth-smoke.mjs'
import { subscribed } from './self-host-staging-realtime-smoke.mjs'

function appendFailure(prior, error) {
  return prior ? new AggregateError([prior, error], 'Message CDC smoke and cleanup failed') : error
}

export async function runStagingMessageCdcSmoke(env = process.env) {
  const { auth } = validateStagingAuthSmokeEnv(env)
  assert.ok(env.PUDDLE_STAGING_ANON_KEY, 'A self-hosted staging anon key is required')
  const admin = createClient(auth, env.PUDDLE_STAGING_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
  const receiver = createClient(auth, env.PUDDLE_STAGING_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
  const password = randomBytes(36).toString('base64url')
  const users = []
  let conversationId
  let friendshipCreated = false
  let channel
  let failure
  try {
    for (const role of ['sender', 'receiver']) {
      const email = `puddle-message-smoke-${role}-${randomUUID()}@example.invalid`
      const created = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { display_name: `Staging ${role}` }
      })
      assert.equal(created.error, null)
      users.push({ id: created.data.user.id, email })
      const profile = await admin.from('profiles').upsert({
        id: created.data.user.id,
        display_name: `Staging ${role}`,
        username: `staging_${created.data.user.id.replaceAll('-', '').slice(0, 12)}`,
        birth_date: '2000-01-01', city: 'Toronto',
        onboarding_completed_at: new Date().toISOString()
      })
      assert.equal(profile.error, null)
    }
    const friendship = await admin.from('friendships').insert({
      requester_id: users[0].id, addressee_id: users[1].id, state: 'accepted'
    })
    assert.equal(friendship.error, null)
    friendshipCreated = true
    const conversation = await admin.from('conversations').insert({ kind: 'direct' }).select('id').single()
    assert.equal(conversation.error, null)
    conversationId = conversation.data.id
    const members = await admin.from('conversation_members').insert(users.map(({ id }) => ({
      conversation_id: conversationId, profile_id: id
    })))
    assert.equal(members.error, null)

    const login = await receiver.auth.signInWithPassword({ email: users[1].email, password })
    assert.equal(login.error, null)
    assert.equal(login.data.user?.id, users[1].id)
    await receiver.realtime.setAuth(login.data.session.access_token)
    const nonce = randomUUID()
    let resolveEvent
    let receivedEvents = 0
    const received = new Promise((resolve) => { resolveEvent = resolve })
    channel = receiver.channel(`staging-message-${nonce}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}`
      }, ({ new: message }) => {
        receivedEvents += 1
        if (message.conversation_id === conversationId && message.body === `Staging CDC ${nonce}`) {
          resolveEvent(message)
        }
      })
    await subscribed(channel)
    // Realtime can acknowledge a channel before its replication listener is
    // ready. Give that listener a bounded startup interval before the write.
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    const inserted = await admin.from('messages').insert({
      conversation_id: conversationId, sender_id: users[0].id, body: `Staging CDC ${nonce}`
    }).select('id').single()
    assert.equal(inserted.error, null)
    const visible = await receiver.from('messages').select('id').eq('id', inserted.data.id).single()
    assert.equal(visible.error, null, 'The receiving member must be able to read the new message under RLS')
    const observed = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Authorized message change did not reach Realtime; received ${receivedEvents} change events`)), 20_000)
      received.then((value) => { clearTimeout(timeout); resolve(value) })
    })
    assert.equal(observed.id, inserted.data.id)
    process.stdout.write('Staging message INSERT reached an authorized conversation member over Realtime.\n')
  } catch (error) {
    failure = error
  } finally {
    if (channel) {
      const removed = await receiver.removeChannel(channel)
      if (removed !== 'ok') failure = appendFailure(failure, new Error('Message Realtime channel did not unsubscribe cleanly'))
    }
    await receiver.realtime.disconnect()
    if (conversationId) {
      const deleted = await admin.from('conversations').delete().eq('id', conversationId)
      if (deleted.error) failure = appendFailure(failure, new Error(`Disposable conversation cleanup failed: ${deleted.error.message}`))
    }
    if (friendshipCreated) {
      const deleted = await admin.from('friendships').delete()
        .eq('requester_id', users[0].id).eq('addressee_id', users[1].id)
      if (deleted.error) failure = appendFailure(failure, new Error(`Disposable friendship cleanup failed: ${deleted.error.message}`))
    }
    for (const user of users) {
      const deleted = await admin.auth.admin.deleteUser(user.id)
      if (deleted.error) failure = appendFailure(failure, new Error(`Disposable account cleanup failed: ${deleted.error.message}`))
    }
  }
  if (failure) throw failure
  process.stdout.write('Disposable staging conversation, friendship, and accounts removed.\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStagingMessageCdcSmoke().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
