import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { membershipFromSubscription, retrieveSubscription, verifyStripeWebhook } from '@/lib/billing/stripe'

export const dynamic = 'force-dynamic'

const INVOICE_SUBSCRIPTION_EVENTS = new Set(['invoice.paid', 'invoice.payment_failed'])

function isUuid(value) {
  return /^[0-9a-f-]{36}$/i.test(String(value || '').trim())
}

async function membershipUserId(admin, subscription, fallbackUserId = null) {
  const metadataUserId = String(subscription?.metadata?.puddle_user_id || fallbackUserId || '').trim()
  if (/^[0-9a-f-]{36}$/i.test(metadataUserId)) return metadataUserId
  const subscriptionId = subscription?.id || null
  const customerId = typeof subscription?.customer === 'string' ? subscription.customer : subscription?.customer?.id || null
  let query = admin.from('puddle_memberships').select('user_id')
  if (subscriptionId) query = query.eq('stripe_subscription_id', subscriptionId)
  else if (customerId) query = query.eq('stripe_customer_id', customerId)
  else return null
  const result = await query.maybeSingle()
  if (result.error) throw result.error
  return result.data?.user_id || null
}

async function syncSubscription(admin, subscription, fallbackUserId = null) {
  const userId = await membershipUserId(admin, subscription, fallbackUserId)
  if (!userId) {
    const metadata = subscription?.metadata || {}
    if (metadata.puddle_tier === 'tinder' || isUuid(fallbackUserId)) {
      throw new Error('Stripe subscription is not linked to a Puddle user.')
    }
    return false
  }
  const record = membershipFromSubscription(subscription, userId)
  const saved = await admin.from('puddle_memberships').upsert(record, { onConflict: 'user_id' })
  if (saved.error) throw saved.error
  return true
}

async function currentSubscription(value) {
  const id = typeof value === 'string' ? value : value?.id
  if (!id) throw new Error('Subscription identifier is missing.')
  return retrieveSubscription(id)
}

export async function POST(request) {
  const rawBody = await request.text()
  const signature = request.headers.get('stripe-signature')
  if (!verifyStripeWebhook(rawBody, signature)) return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 400 })

  let event
  try { event = JSON.parse(rawBody) }
  catch { return NextResponse.json({ error: 'Invalid webhook body.' }, { status: 400 }) }
  if (!event?.id || !event?.type) return NextResponse.json({ error: 'Invalid webhook event.' }, { status: 400 })

  const admin = createAdminClient()
  const existing = await admin.from('stripe_membership_events').select('event_id').eq('event_id', event.id).maybeSingle()
  if (existing.data) return NextResponse.json({ received: true, duplicate: true })

  try {
    const object = event.data?.object || {}
    if (event.type === 'checkout.session.completed' && object.mode === 'subscription' && object.subscription) {
      const subscription = await currentSubscription(object.subscription)
      await syncSubscription(admin, subscription, object.client_reference_id)
    } else if (event.type.startsWith('customer.subscription.')) {
      const subscription = await currentSubscription(object)
      await syncSubscription(admin, subscription)
    } else if (INVOICE_SUBSCRIPTION_EVENTS.has(event.type) && object.subscription) {
      const subscription = await currentSubscription(object.subscription)
      await syncSubscription(admin, subscription)
    }
    const recorded = await admin.from('stripe_membership_events').insert({ event_id: event.id, event_type: event.type })
    if (recorded.error && recorded.error.code !== '23505') throw recorded.error
    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Stripe membership webhook failed.', {
      eventId: event.id,
      eventType: event.type,
      message: String(error?.message || 'unknown').slice(0, 240)
    })
    return NextResponse.json({ error: 'Webhook processing failed.' }, { status: 500 })
  }
}
