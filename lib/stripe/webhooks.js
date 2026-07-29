import { issueTicketToken } from '../tickets/signing.js'
import { retrievePaymentIntent } from './client.js'

function cleanError(error) {
  const message = String(error?.message || error || 'Stripe event processing failed.').slice(0, 1000)
  return /policy|schema|relation|column|constraint|service role/i.test(message) ? 'Stripe event processing failed.' : message
}

async function issueOrderTickets(admin, orderId) {
  const { data: tickets, error } = await admin.from('tickets')
    .select('id,event_id,order_id,owner_id,ticket_number,token_version,signed_token')
    .eq('order_id', orderId)
    .in('status', ['valid','transferred'])
  if (error) throw error
  for (const ticket of tickets || []) {
    if (ticket.signed_token) continue
    const signed = issueTicketToken(ticket)
    const { error: updateError } = await admin.from('tickets').update({
      signed_token: signed.token,
      signed_code_hash: signed.hash,
      signed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', ticket.id).eq('token_version', ticket.token_version)
    if (updateError) throw updateError
  }
}

async function fulfillCheckout(admin, object, stripeEventId) {
  if (object.payment_status && object.payment_status !== 'paid') return { status: 'waiting_for_payment' }
  const orderId = object.metadata?.puddle_order_id || object.client_reference_id
  if (!orderId) return { status: 'ignored_missing_order' }
  let paymentIntent = object.payment_intent
  if (typeof paymentIntent === 'string') paymentIntent = await retrievePaymentIntent(paymentIntent)
  if (!paymentIntent && object.object === 'payment_intent') paymentIntent = object
  if (!paymentIntent || paymentIntent.status !== 'succeeded') return { status: 'waiting_for_payment' }
  let charge = paymentIntent.latest_charge
  if (!charge || typeof charge === 'string') {
    paymentIntent = await retrievePaymentIntent(paymentIntent.id)
    charge = paymentIntent.latest_charge
  }
  if (!charge || typeof charge === 'string') throw new Error('Stripe payment charge is unavailable.')
  const { data, error } = await admin.rpc('fulfill_paid_order_v1', {
    target_order: orderId,
    stripe_session: object.object === 'checkout.session' ? object.id : null,
    stripe_payment_intent: paymentIntent.id,
    stripe_charge: charge.id,
    paid_amount: Number(object.amount_total ?? paymentIntent.amount_received ?? charge.amount),
    paid_currency: String(object.currency || paymentIntent.currency || charge.currency || '').toUpperCase(),
    receipt_url_value: charge.receipt_url || null,
    stripe_event: stripeEventId
  })
  if (error) throw error
  if (data?.status === 'paid' || data?.status === 'already_paid') await issueOrderTickets(admin, orderId)
  return data || { status: 'processed' }
}

async function updateConnectAccount(admin, account) {
  const profileId = account.metadata?.puddle_profile_id
  const fields = {
    stripe_account_id: account.id,
    account_type: account.type || 'express',
    country: account.country || null,
    details_submitted: Boolean(account.details_submitted),
    charges_enabled: Boolean(account.charges_enabled),
    payouts_enabled: Boolean(account.payouts_enabled),
    identity_status: account.requirements?.disabled_reason ? 'restricted' : account.charges_enabled && account.payouts_enabled ? 'verified' : account.details_submitted ? 'submitted' : 'pending',
    payout_status: account.payouts_enabled ? 'enabled' : 'pending',
    requirements_due: account.requirements?.currently_due || [],
    disabled_reason: account.requirements?.disabled_reason || null,
    updated_at: new Date().toISOString()
  }
  let query = admin.from('stripe_connected_accounts').update(fields).eq('stripe_account_id', account.id)
  const { data } = await query.select('profile_id').maybeSingle()
  if (!data && profileId) {
    const { error } = await admin.from('stripe_connected_accounts').upsert({ profile_id: profileId, ...fields }, { onConflict: 'profile_id' })
    if (error) throw error
  }
  return { status: 'account_updated' }
}

async function processRefund(admin, refund, stripeEventId) {
  const { data, error } = await admin.rpc('apply_stripe_refund_update_v1', {
    stripe_refund: refund.id,
    stripe_charge: typeof refund.charge === 'string' ? refund.charge : refund.charge?.id,
    refund_amount: Number(refund.amount || 0),
    refund_status: String(refund.status || 'pending'),
    failure_reason_value: refund.failure_reason || null,
    stripe_event: stripeEventId
  })
  if (error) throw error
  return data
}

async function processDispute(admin, dispute, stripeEventId) {
  const { data, error } = await admin.rpc('record_stripe_dispute_v1', {
    stripe_dispute: dispute.id,
    stripe_charge: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id,
    dispute_amount: Number(dispute.amount || 0),
    dispute_currency: String(dispute.currency || '').toUpperCase(),
    dispute_status: String(dispute.status || 'warning_needs_response'),
    dispute_reason: dispute.reason || null,
    evidence_due: dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000).toISOString() : null,
    stripe_event: stripeEventId
  })
  if (error) throw error
  return data
}

async function processPayout(admin, payout, connectedAccount, stripeEventId) {
  const { data, error } = await admin.rpc('record_stripe_payout_v1', {
    stripe_payout: payout.id,
    stripe_account: connectedAccount || null,
    payout_amount: Number(payout.amount || 0),
    payout_currency: String(payout.currency || '').toUpperCase(),
    payout_status: String(payout.status || 'pending'),
    arrival_at_value: payout.arrival_date ? new Date(payout.arrival_date * 1000).toISOString() : null,
    failure_code_value: payout.failure_code || null,
    failure_message_value: payout.failure_message || null,
    stripe_event: stripeEventId
  })
  if (error) throw error
  return data
}

export async function storeStripeWebhookEvent(admin, event) {
  const row = {
    stripe_event_id: event.id,
    event_type: event.type,
    livemode: Boolean(event.livemode),
    connected_account_id: event.account || null,
    api_version: event.api_version || null,
    created_at_stripe: event.created ? new Date(event.created * 1000).toISOString() : null,
    payload: event,
    status: 'pending',
    next_attempt_at: new Date().toISOString()
  }
  const inserted = await admin.from('stripe_webhook_events').insert(row).select('id,stripe_event_id,status').maybeSingle()
  if (!inserted.error) return { ...inserted.data, duplicate: false }
  if (inserted.error.code !== '23505') throw inserted.error
  const existing = await admin.from('stripe_webhook_events').select('id,stripe_event_id,status').eq('stripe_event_id', event.id).maybeSingle()
  if (existing.error) throw existing.error
  return { ...existing.data, duplicate: true }
}

export async function processStripeWebhookPayload(admin, event) {
  const object = event.data?.object || {}
  if (event.type === 'account.updated') return updateConnectAccount(admin, object)
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') return fulfillCheckout(admin, object, event.id)
  if (event.type === 'payment_intent.succeeded') return fulfillCheckout(admin, object, event.id)
  if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
    const orderId = object.metadata?.puddle_order_id || object.client_reference_id
    if (!orderId) return { status: 'ignored_missing_order' }
    const { data, error } = await admin.rpc('cancel_order_reservation_v1', { target_order: orderId, cancellation_reason: event.type })
    if (error) throw error
    return data
  }
  if (event.type.startsWith('refund.')) return processRefund(admin, object, event.id)
  if (event.type.startsWith('charge.dispute.')) return processDispute(admin, object, event.id)
  if (event.type.startsWith('payout.')) return processPayout(admin, object, event.account, event.id)
  return { status: 'ignored' }
}

export async function processPendingStripeWebhooks(admin, batchSize = 25) {
  const { data: rows, error } = await admin.rpc('claim_stripe_webhook_events_v1', { batch_size: Math.max(1, Math.min(100, batchSize)) })
  if (error) throw error
  const results = []
  for (const row of rows || []) {
    try {
      const result = await processStripeWebhookPayload(admin, row.payload)
      const complete = await admin.rpc('complete_stripe_webhook_event_v1', { target_event: row.id, succeeded: true, result_data: result || {}, error_message: null })
      if (complete.error) throw complete.error
      results.push({ id: row.id, ok: true, result })
    } catch (error) {
      await admin.rpc('complete_stripe_webhook_event_v1', { target_event: row.id, succeeded: false, result_data: {}, error_message: cleanError(error) })
      results.push({ id: row.id, ok: false, error: cleanError(error) })
    }
  }
  return results
}
