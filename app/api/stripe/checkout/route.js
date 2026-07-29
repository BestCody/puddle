import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCheckoutSession } from '@/lib/stripe/client'
import { isSupabaseConfigured } from '@/lib/supabase/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Checkout is unavailable.' }, { status: 503 })
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to buy tickets.' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  if (!UUID.test(String(body.eventId || '')) || !Array.isArray(body.items) || !UUID.test(String(body.idempotencyKey || ''))) return NextResponse.json({ error: 'That checkout request is invalid.' }, { status: 400 })
  const items = body.items.slice(0, 10).map((item) => ({ ticket_type_id: String(item.ticketTypeId || ''), quantity: Math.floor(Number(item.quantity || 0)) })).filter((item) => UUID.test(item.ticket_type_id) && item.quantity > 0 && item.quantity <= 20)
  if (!items.length) return NextResponse.json({ error: 'Choose at least one ticket.' }, { status: 400 })
  let orderId
  try {
    const reservation = await supabase.rpc('reserve_paid_order_v1', { target_event: body.eventId, requested_items: items, promo_code_value: String(body.promoCode || '').trim().toUpperCase() || null, request_key: body.idempotencyKey })
    if (reservation.error || !reservation.data?.order) throw reservation.error || new Error('Tickets could not be reserved.')
    const result = reservation.data; orderId = result.order.id
    const minutes = Math.max(30, Math.min(1440, Number(process.env.STRIPE_CHECKOUT_MINUTES || 30)))
    const expiresAt = Math.floor(Date.now() / 1000) + minutes * 60
    const base = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin
    const session = await createCheckoutSession({ order: { ...result.order, buyer_email: user.email }, lineItems: result.line_items, destinationAccount: result.destination_account, successUrl: `${base}/orders/${orderId}?checkout=returned`, cancelUrl: `${base}/events/${result.event_slug}?checkout=cancelled`, expiresAt })
    const attached = await supabase.rpc('attach_checkout_session_v1', { target_order: orderId, stripe_session: session.id, checkout_expires_at: new Date(expiresAt * 1000).toISOString() })
    if (attached.error) throw attached.error
    return NextResponse.json({ orderId, sessionId: session.id, url: session.url })
  } catch (error) {
    if (orderId) await supabase.rpc('cancel_order_reservation_v1', { target_order: orderId, cancellation_reason: 'checkout_creation_failed' })
    const message = String(error?.message || 'Checkout could not start.').slice(0, 240)
    return NextResponse.json({ error: /inventory|available|limit|sales|promo|payout/i.test(message) ? message : 'Checkout could not start.' }, { status: 400 })
  }
}
