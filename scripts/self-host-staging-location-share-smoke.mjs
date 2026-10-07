import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { validateStagingAuthSmokeEnv } from './self-host-staging-auth-smoke.mjs'

function client(url, key) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
}

function appendFailure(prior, error) {
  return prior ? new AggregateError([prior, error], 'Location-share smoke and cleanup failed') : error
}

export async function runStagingLocationShareSmoke(env = process.env) {
  const { auth } = validateStagingAuthSmokeEnv(env)
  assert.ok(env.PUDDLE_STAGING_ANON_KEY, 'A self-hosted staging anon key is required')
  const admin = client(auth, env.PUDDLE_STAGING_SERVICE_KEY)
  const sender = client(auth, env.PUDDLE_STAGING_ANON_KEY)
  const receiver = client(auth, env.PUDDLE_STAGING_ANON_KEY)
  const outsider = client(auth, env.PUDDLE_STAGING_ANON_KEY)
  const password = randomBytes(36).toString('base64url')
  const users = []
  const shareIds = []
  let conversationId
  let friendshipCreated = false
  let failure
  try {
    const locations = await admin.from('location_refs').select('id').order('id').limit(2)
    assert.equal(locations.error, null)
    assert.equal(locations.data.length, 2, 'Restored staging database needs two canonical location references')
    for (const role of ['sender', 'receiver', 'outsider']) {
      const email = `puddle-share-smoke-${role}-${randomUUID()}@example.invalid`
      const created = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { display_name: `Staging ${role}` }
      })
      assert.equal(created.error, null)
      const id = created.data.user.id
      users.push({ id, email })
      const profile = await admin.from('profiles').upsert({
        id, display_name: `Staging ${role}`,
        username: `staging_${id.replaceAll('-', '').slice(0, 12)}`,
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

    for (const [who, account] of [[sender, users[0]], [receiver, users[1]], [outsider, users[2]]]) {
      const login = await who.auth.signInWithPassword({ email: account.email, password })
      assert.equal(login.error, null)
      assert.equal(login.data.user?.id, account.id)
    }

    const friendKey = randomUUID()
    const friendShare = await sender.rpc('send_location_to_friend_v1', {
      target_friend: users[1].id,
      target_location: locations.data[0].id,
      request_key: friendKey,
      share_note: 'Staging place share'
    })
    assert.equal(friendShare.error, null)
    assert.ok(friendShare.data?.shareId && friendShare.data?.messageId && friendShare.data?.conversationId)
    shareIds.push(friendShare.data.shareId)
    conversationId = friendShare.data.conversationId

    const retry = await sender.rpc('send_location_to_friend_v1', {
      target_friend: users[1].id,
      target_location: locations.data[0].id,
      request_key: friendKey,
      share_note: 'Staging place share'
    })
    assert.equal(retry.error, null)
    assert.deepEqual(retry.data, friendShare.data, 'Retry must return the same canonical share and message')
    const reusedKey = await sender.rpc('send_location_to_friend_v1', {
      target_friend: users[1].id,
      target_location: locations.data[1].id,
      request_key: friendKey,
      share_note: 'A different place must fail'
    })
    assert.ok(reusedKey.error, 'A request key cannot be reused for a different place')

    const chatKey = randomUUID()
    const chatShare = await sender.rpc('social_send_location_message_v1', {
      target: conversationId,
      target_location: locations.data[1].id,
      request_key: chatKey
    })
    assert.equal(chatShare.error, null)
    assert.ok(chatShare.data)
    const chatRetry = await sender.rpc('social_send_location_message_v1', {
      target: conversationId,
      target_location: locations.data[1].id,
      request_key: chatKey
    })
    assert.equal(chatRetry.error, null)
    assert.equal(chatRetry.data, chatShare.data, 'Chat-share retry must not create another message')

    const messages = await receiver.from('messages')
      .select('id,conversation_id,message_type,metadata,share_key')
      .eq('conversation_id', conversationId).in('share_key', [friendKey, chatKey])
    assert.equal(messages.error, null)
    assert.equal(messages.data.length, 2, 'Receiver must see exactly one message per share key')
    assert.ok(messages.data.every((message) => message.message_type === 'location'))
    assert.deepEqual(
      new Set(messages.data.map((message) => message.metadata?.locationId)),
      new Set(locations.data.map((location) => location.id))
    )

    const shared = await receiver.rpc('social_shared_locations_v2', {
      before_created_at: null, before_share_id: null, result_limit: 100
    })
    assert.equal(shared.error, null)
    const received = shared.data.filter((row) => row.friend_id === users[0].id && row.direction === 'received')
    assert.equal(received.length, 2, 'Both share paths must appear once in the recipient Shared tab')
    assert.deepEqual(
      new Set(received.map((row) => row.location_id)),
      new Set(locations.data.map((location) => location.id))
    )
    const hiddenMessages = await outsider.from('messages').select('id').eq('conversation_id', conversationId)
    assert.equal(hiddenMessages.error, null)
    assert.equal(hiddenMessages.data.length, 0, 'An unrelated account must not read the conversation')
    const hiddenShares = await outsider.rpc('social_shared_locations_v2', {
      before_created_at: null, before_share_id: null, result_limit: 100
    })
    assert.equal(hiddenShares.error, null)
    assert.equal(hiddenShares.data.length, 0, 'An unrelated account must not see Shared history')
    const strangerShare = await sender.rpc('send_location_to_friend_v1', {
      target_friend: users[2].id,
      target_location: locations.data[0].id,
      request_key: randomUUID(),
      share_note: 'Unfriended recipient must fail'
    })
    assert.ok(strangerShare.error, 'A place share must reject an unfriended recipient')
    shareIds.push(...received.map((row) => row.share_id))
    process.stdout.write('Staging friend/chat place shares, recipient views, outsider isolation, and retries passed.\n')
  } catch (error) {
    failure = error
  } finally {
    if (conversationId) {
      const deleted = await admin.from('conversations').delete().eq('id', conversationId)
      if (deleted.error) failure = appendFailure(failure, new Error(`Disposable conversation cleanup failed: ${deleted.error.message}`))
    }
    if (shareIds.length) {
      const deleted = await admin.from('content_shares').delete().in('id', [...new Set(shareIds)])
      if (deleted.error) failure = appendFailure(failure, new Error(`Disposable shares cleanup failed: ${deleted.error.message}`))
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
  process.stdout.write('Disposable staging shares, conversation, friendship, and accounts removed.\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStagingLocationShareSmoke().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
