"use client"

import { useMemo, useRef, useState } from 'react'

function money(cents, currency = 'CAD') {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(Number(cents || 0) / 100)
}

export function TicketPurchasePanel({ eventId, eventSlug, tiers = [] }) {
  const [quantities, setQuantities] = useState({})
  const [promoCode, setPromoCode] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const checkoutKey = useRef(null)
  const total = useMemo(() => tiers.reduce((sum, tier) => sum + Number(quantities[tier.id] || 0) * Number(tier.price_cents || 0), 0), [quantities, tiers])

  async function checkout() {
    if (checkoutKey.current) return
    const items = tiers.map((tier) => ({ ticketTypeId: tier.id, quantity: Number(quantities[tier.id] || 0) })).filter((item) => item.quantity > 0)
    if (!items.length) { setMessage('Choose at least one ticket.'); return }
    checkoutKey.current = crypto.randomUUID(); setLoading(true); setMessage('Holding your tickets…')
    const response = await fetch('/api/stripe/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventId, items, promoCode, idempotencyKey: checkoutKey.current })
    })
    const result = await response.json().catch(() => ({}))
    setLoading(false)
    if (response.status === 401) { checkoutKey.current = null; window.location.href = `/signin?next=${encodeURIComponent(`/events/${eventSlug}`)}`; return }
    if (!response.ok || !result.url) { checkoutKey.current = null; setMessage(result.error || 'Checkout could not start.'); return }
    window.location.href = result.url
  }

  if (!tiers.length) return null
  return <section className="ticket-purchase-panel public-section">
    <div className="public-section-heading"><div><span className="section-pill section-pill-yellow">Tickets</span><h2>Choose your ticket.</h2></div><strong>{total ? money(total, tiers[0]?.currency) : 'Select a tier'}</strong></div>
    <div className="ticket-tier-list">{tiers.map((tier) => <article className="ticket-tier" key={tier.id}>
      <div><h3>{tier.name}</h3><p>{tier.description || 'Admission to this event.'}</p><small>{tier.available_quantity} available · Up to {tier.max_per_order} per order</small></div>
      <div><strong>{money(tier.price_cents, tier.currency)}</strong><label>Quantity<select value={quantities[tier.id] || 0} onChange={(event) => setQuantities((current) => ({ ...current, [tier.id]: Number(event.target.value) }))}>{[0, ...Array.from({ length: Math.max(0, Math.min(tier.max_per_order, tier.available_quantity) - tier.min_per_order + 1) }, (_, index) => tier.min_per_order + index)].map((value) => <option value={value} key={value}>{value}</option>)}</select></label></div>
    </article>)}</div>
    <div className="ticket-checkout-row"><label>Promo code<input value={promoCode} onChange={(event) => setPromoCode(event.target.value.toUpperCase())} maxLength={32} placeholder="Optional" /></label><button className="splash-button splash-button-pink" type="button" disabled={loading} onClick={checkout}>{loading ? 'Starting checkout…' : 'Continue to secure checkout'}</button></div>
    <p className="ticket-note">Tickets are issued only after Puddle receives verified payment confirmation from Stripe.</p>{message ? <p className="discovery-message">{message}</p> : null}
  </section>
}
