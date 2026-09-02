import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const envPath = args.find((value) => !value.startsWith('--'))
const shouldDelete = args.includes('--delete')
const confirmation = args.find((value) => value.startsWith('--confirm='))?.slice('--confirm='.length) || ''
const postgrestBatchSize = 100

if (envPath && !fs.existsSync(envPath)) throw new Error('The supplied production environment file does not exist.')

function loadEnv(path) {
  const values = {}
  for (const raw of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const separator = raw.indexOf('=')
    if (separator < 1) continue
    let value = raw.slice(separator + 1).trim()
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1)
    }
    values[raw.slice(0, separator)] = value
  }
  return values
}

const env = envPath ? loadEnv(envPath) : process.env
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceKey) {
  throw new Error(JSON.stringify({
    missing: {
      supabaseUrl: !supabaseUrl,
      serviceKey: !serviceKey
    },
    visibleSupabaseEnv: Object.keys(env).filter((name) => name.includes('SUPABASE')).sort(),
    serviceKeyLength: String(serviceKey || '').length
  }))
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const emailPatterns = [
  ['email:puddle-e2e', /^puddle-e2e-/],
  ['email:complete-flow', /^complete-flow-/],
  ['email:puddle-live', /^puddle-live-/],
  ['email:puddle-load', /^puddle-load-/],
  ['email:puddle-ui-owner', /^puddle-ui-owner-/],
  ['email:puddle-ui-friend', /^puddle-ui-friend-/],
  ['email:puddle-test', /^puddle-test-/]
]
const usernamePatterns = [
  ['username:e2e_', /^e2e_/],
  ['username:live_', /^live_/],
  ['username:load_', /^load_/],
  ['username:uio_', /^uio_/],
  ['username:uif_', /^uif_/]
]
const exactDisplayNames = new Set([
  'E2E Person',
  'Puddle Live Smoke',
  'Completed UI',
  'UI Friend'
])

// These are the user-owned relations that can prevent Supabase from deleting
// the parent profile when older migrations left a restrictive foreign key in
// place. The audit is deliberately explicit: it never scans or mutates rows
// belonging to another profile.
const profileRelationProbes = [
  ['puddle_memberships', 'user_id'],
  ['organizers', 'owner_id'],
  ['conversations', 'created_by'],
  ['messages', 'sender_id'],
  ['inventory_reservations', 'profile_id'],
  ['orders', 'buyer_id'],
  ['tickets', 'owner_id'],
  ['reports', 'reporter_id'],
  ['audit_logs', 'actor_id'],
  ['host_announcements', 'author_id'],
  ['event_checkins', 'checked_in_by'],
  ['plan_stops', 'added_by'],
  ['plan_polls', 'created_by'],
  ['promo_redemptions', 'profile_id'],
  ['refund_requests', 'requester_id'],
  ['ticket_transfers', 'sender_id'],
  ['ticket_transfers', 'recipient_id'],
  ['ticket_checkin_events', 'staff_id'],
  ['bulk_operations', 'requested_by']
]

async function listUsers() {
  const users = []
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const batch = data?.users || []
    users.push(...batch)
    if (batch.length < 1000) return users
  }
  throw new Error('More than 100,000 users found; refusing an incomplete cleanup.')
}

async function loadProfiles(users) {
  const profiles = new Map()
  const ids = users.map((user) => user.id)
  for (let offset = 0; offset < ids.length; offset += postgrestBatchSize) {
    const batch = ids.slice(offset, offset + postgrestBatchSize)
    if (!batch.length) continue
    const { data, error } = await admin.from('profiles').select('id,username,display_name').in('id', batch)
    if (error) throw error
    for (const profile of data || []) profiles.set(profile.id, profile)
  }
  return profiles
}

function classify(user, profile) {
  const email = String(user.email || '').toLowerCase()
  const localPart = email.split('@')[0]
  const username = String(profile?.username || user.user_metadata?.username || '').toLowerCase()
  const displayName = String(profile?.display_name || user.user_metadata?.display_name || '')
  const reasons = []
  // The test suite uses RFC-reserved example.com addresses. They are not
  // deliverable production identities, so every account on this domain is a
  // disposable test account for this cleanup.
  if (email.endsWith('@example.com')) reasons.push('email-domain:example.com')
  for (const [label, pattern] of emailPatterns) if (pattern.test(localPart)) reasons.push(label)
  for (const [label, pattern] of usernamePatterns) if (pattern.test(username)) reasons.push(label)
  if (exactDisplayNames.has(displayName)) reasons.push(`display_name:${displayName}`)
  return reasons
}

async function ownedStorageObjects(userIds) {
  if (!userIds.length) return []
  const objects = []
  for (let offset = 0; offset < userIds.length; offset += postgrestBatchSize) {
    const batch = userIds.slice(offset, offset + postgrestBatchSize)
    const { data, error } = await admin
      .from('media_assets')
      .select('bucket_id,object_path,owner_id')
      .in('owner_id', batch)
    if (error) throw error
    objects.push(...(data || []).map((asset) => ({
      bucket_id: asset.bucket_id,
      name: asset.object_path,
      owner: asset.owner_id
    })))
  }
  return objects
}

async function profileRelationCounts(userIds) {
  const counts = []
  for (const [table, column] of profileRelationProbes) {
    let count = 0
    for (let offset = 0; offset < userIds.length; offset += postgrestBatchSize) {
      const batch = userIds.slice(offset, offset + postgrestBatchSize)
      if (!batch.length) continue
      const result = await admin.from(table).select(column).in(column, batch)
      // Some deployments do not contain every later-stage table. Missing
      // optional relations are not a cleanup failure.
      if (result.error) {
        if (['PGRST205', 'PGRST204', '42703'].includes(result.error.code)) break
        throw result.error
      }
      count += result.data?.length || 0
    }
    if (count) counts.push({ table, column, count })
  }
  return counts
}

async function removeOwnedStorage(objects) {
  const byBucket = new Map()
  for (const object of objects) {
    if (!object.bucket_id || !object.name) continue
    const paths = byBucket.get(object.bucket_id) || []
    paths.push(object.name)
    byBucket.set(object.bucket_id, paths)
  }
  let removed = 0
  for (const [bucket, paths] of byBucket) {
    for (let offset = 0; offset < paths.length; offset += 100) {
      const { error } = await admin.storage.from(bucket).remove(paths.slice(offset, offset + 100))
      if (error) throw new Error(`Could not remove owned Storage objects from ${bucket}: ${error.message}`)
      removed += Math.min(100, paths.length - offset)
    }
  }
  return removed
}

async function main() {
  const users = await listUsers()
  console.log(JSON.stringify({ phase: 'enumerated-auth-users', count: users.length }))
  const profiles = await loadProfiles(users)
  const domains = {}
  const candidates = []
  const unmatchedExampleDomain = []

  for (const user of users) {
    const email = String(user.email || '').toLowerCase()
    const domain = email.includes('@') ? email.split('@').pop() : '(none)'
    domains[domain] = (domains[domain] || 0) + 1
    const reasons = classify(user, profiles.get(user.id))
    if (reasons.length) candidates.push({ user, profile: profiles.get(user.id), reasons })
    else if (domain === 'example.com') unmatchedExampleDomain.push({ user, profile: profiles.get(user.id) })
  }

  const summary = {
    totalUsers: users.length,
    domains,
    candidateCount: candidates.length,
    candidates: candidates.map(({ user, profile, reasons }) => ({
      id: user.id,
      createdAt: user.created_at,
      profileUsername: profile?.username || null,
      displayName: profile?.display_name || user.user_metadata?.display_name || null,
      reasons
    })),
    unmatchedExampleDomainCount: unmatchedExampleDomain.length,
    unmatchedExampleDomain: unmatchedExampleDomain.slice(0, 20).map(({ user, profile }) => ({
      createdAt: user.created_at,
      displayName: profile?.display_name || user.user_metadata?.display_name || null
    }))
  }

  if (!shouldDelete) {
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  if (confirmation !== 'DELETE_TEST_ACCOUNTS') throw new Error('Exact deletion confirmation is required.')
  console.log(JSON.stringify({
    action: 'delete',
    candidateCount: candidates.length,
    candidateIds: candidates.map(({ user }) => user.id),
    scope: 'auth users and records owned by those users'
  }, null, 2))
  const objects = await ownedStorageObjects(candidates.map(({ user }) => user.id))
  const relationCounts = await profileRelationCounts(candidates.map(({ user }) => user.id))
  console.log(JSON.stringify({ phase: 'audited-restrictive-profile-relations', relationCounts }))
  const removedStorageObjects = await removeOwnedStorage(objects)
  const deleted = []
  const failures = []
  for (const { user, reasons } of candidates) {
    const { error } = await admin.auth.admin.deleteUser(user.id, false)
    if (error) failures.push({ id: user.id, reasons, error: error.message })
    else deleted.push({ id: user.id, reasons })
  }
  if (failures.length) throw new Error(JSON.stringify({ deleted, failures, removedStorageObjects }))

  const deletedIds = deleted.map(({ id }) => id)
  const remainingUsers = await listUsers()
  const remainingProfiles = await loadProfiles(remainingUsers)
  const remainingCandidates = remainingUsers
    .map((user) => ({ user, profile: remainingProfiles.get(user.id), reasons: classify(user, remainingProfiles.get(user.id)) }))
    .filter(({ reasons }) => reasons.length)
  const remainingDeletedProfiles = []
  for (let offset = 0; offset < deletedIds.length; offset += postgrestBatchSize) {
    const batch = deletedIds.slice(offset, offset + postgrestBatchSize)
    if (!batch.length) continue
    const { data, error } = await admin.from('profiles').select('id').in('id', batch)
    if (error) throw error
    remainingDeletedProfiles.push(...(data || []).map(({ id }) => id))
  }
  if (remainingDeletedProfiles.length) {
    const { error } = await admin.from('profiles').delete().in('id', remainingDeletedProfiles)
    if (error) throw new Error(`Could not remove orphaned test profiles: ${error.message}`)
  }
  const remainingStorage = await ownedStorageObjects(deletedIds)
  const result = {
    ...summary,
    deletedCount: deleted.length,
    removedStorageObjects,
    removedOrphanedProfiles: remainingDeletedProfiles.length,
    remainingOwnedStorageObjects: remainingStorage.length,
    remainingCandidateCount: remainingCandidates.length,
    remainingCandidates: remainingCandidates.map(({ user, reasons }) => ({ id: user.id, reasons }))
  }
  console.log(JSON.stringify(result, null, 2))
  if (remainingCandidates.length || remainingStorage.length) throw new Error('Candidate test accounts or owned storage objects remain after cleanup.')
}

main().catch((error) => {
  const cause = error?.cause
  console.error(JSON.stringify({
    name: error?.name || 'Error',
    message: error?.message || String(error),
    cause: cause ? {
      name: cause.name || null,
      message: cause.message || null,
      code: cause.code || null,
      errno: cause.errno || null,
      syscall: cause.syscall || null,
      hostname: cause.hostname || null
    } : null
  }))
  process.exitCode = 1
})
