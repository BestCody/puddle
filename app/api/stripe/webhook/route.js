import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripeMode, verifyStripeWebhook } from '@/lib/stripe/client'
import { storeStripeWebhookEvent } from '@/lib/stripe/webhooks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  const raw = await request.text()
  if (Buffer.byteLength(raw) > 2_000_000) return NextResponse.json({ error: 'Payload too large.' }, { status: 413 })
  try { verifyStripeWebhook(raw, request.headers.get('stripe-signature')) } catch { return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 }) }
  let event
  try { event = JSON.parse(raw) } catch { return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 }) }
  if (Boolean(event.livemode) !== (stripeMode() === 'live')) return NextResponse.json({ error: 'Stripe mode mismatch.' }, { status: 400 })
  const admin = createAdminClient()
  try {
    const stored = await storeStripeWebhookEvent(admin, event)
    return NextResponse.json({ received: true, queued: true, duplicate: stored.duplicate })
  } catch { return NextResponse.json({ error: 'Webhook storage failed.' }, { status: 500 }) }
}
