import { createClient } from '@supabase/supabase-js'
import { sendWebPush, webPushConfigured } from '../lib/push/web-push.js'

const apply = process.argv.includes('--apply')
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) throw new Error('Push delivery requires NEXT_PUBLIC_SUPABASE_URL and a Supabase server secret.')
if (!webPushConfigured()) throw new Error('Push delivery requires NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.')

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
if (apply) {
  const scheduled = await admin.rpc('enqueue_location_plan_notifications_v1')
  if (scheduled.error) throw scheduled.error
  console.log(`Enqueued ${Number(scheduled.data || 0)} reminder or feedback notification(s).`)
}

const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
const { data: notifications, error } = await admin
  .from('app_notifications')
  .select('id,profile_id,kind,title,body,href,metadata,created_at,push_attempts')
  .is('push_delivered_at', null)
  .lt('push_attempts', 5)
  .gte('created_at', since)
  .order('created_at')
  .limit(200)
if (error) throw error

const profileIds = [...new Set((notifications || []).map((item) => item.profile_id))]
const { data: subscriptions, error: subscriptionError } = profileIds.length
  ? await admin.from('push_subscriptions').select('id,profile_id,endpoint,p256dh,auth').in('profile_id', profileIds)
  : { data: [], error: null }
if (subscriptionError) throw subscriptionError

const byProfile = new Map()
for (const subscription of subscriptions || []) {
  const current = byProfile.get(subscription.profile_id) || []
  current.push(subscription)
  byProfile.set(subscription.profile_id, current)
}

let sent = 0
let expired = 0
let deferred = 0
for (const notification of notifications || []) {
  const targets = byProfile.get(notification.profile_id) || []
  if (!apply) {
    console.log(`[dry-run] ${notification.kind} → ${targets.length} device(s)`)
    continue
  }

  let successes = 0
  let retryable = false
  let lastError = targets.length ? null : 'No active device subscriptions.'
  for (const subscription of targets) {
    try {
      const result = await sendWebPush(subscription, {
        id: notification.id,
        title: notification.title,
        body: notification.body,
        href: notification.href || '/dashboard',
        tag: `${notification.kind}:${notification.id}`
      })
      if (result.ok) { successes += 1; sent += 1 }
      else if (result.expired) {
        expired += 1
        await admin.from('push_subscriptions').delete().eq('id', subscription.id)
      } else {
        retryable = retryable || result.retryable
        lastError = `Push provider returned ${result.status}.`
      }
    } catch (pushError) {
      retryable = true
      lastError = String(pushError?.message || 'Push delivery failed.').slice(0, 300)
    }
  }

  const attempts = Number(notification.push_attempts || 0) + 1
  if (retryable && successes === 0 && attempts < 5) {
    deferred += 1
    await admin.from('app_notifications').update({ push_attempts: attempts, push_last_error: lastError }).eq('id', notification.id)
  } else {
    await admin.from('app_notifications').update({
      push_attempts: attempts,
      push_delivered_at: new Date().toISOString(),
      push_last_error: successes ? null : lastError
    }).eq('id', notification.id)
  }
}

console.log(JSON.stringify({ apply, notifications: notifications?.length || 0, sent, expiredSubscriptions: expired, deferred }, null, 2))
