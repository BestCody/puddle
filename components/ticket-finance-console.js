"use client"

import Link from 'next/link'
import { useState } from 'react'

function money(cents, currency = 'CAD') { return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(Number(cents || 0) / 100) }

export function TicketFinanceConsole({ eventId, initialDashboard }) {
  const [dashboard, setDashboard] = useState(initialDashboard)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(action, payload = {}) {
    setLoading(true); setMessage('Saving…')
    const response = await fetch(`/api/studio/events/${eventId}/ticketing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...payload }) })
    const result = await response.json().catch(() => ({}))
    setLoading(false)
    if (!response.ok) { setMessage(result.error || 'Ticketing could not be updated.'); return }
    if (result.dashboard) setDashboard(result.dashboard)
    setMessage(result.message || 'Ticketing updated.')
  }

  const event = dashboard.event || {}
  const account = dashboard.payout_account
  return <div className="finance-console">
    {message ? <p className="discovery-message">{message}</p> : null}
    <section className="finance-summary-grid">
      <article className="finance-card"><span className={`finance-status ${account?.charges_enabled && account?.payouts_enabled ? 'is-ready' : 'is-pending'}`}>Payouts</span><h2>{account?.charges_enabled && account?.payouts_enabled ? 'Stripe ready' : 'Setup required'}</h2><p>Paid publishing remains locked until both payments and payouts are enabled.</p><Link href="/settings/payouts">Manage payout onboarding</Link></article>
      <article className="finance-card"><span className="finance-status">Sales</span><h2>{money(dashboard.totals?.gross_cents, event.currency)}</h2><p>{dashboard.totals?.paid_orders || 0} paid orders · {dashboard.totals?.tickets_sold || 0} tickets</p><small>Platform fees {money(dashboard.totals?.platform_fee_cents, event.currency)}</small></article>
      <article className="finance-card"><span className="finance-status">Risk</span><h2>{dashboard.open_disputes || 0} disputes</h2><p>{dashboard.open_refunds || 0} refund requests · {dashboard.fraud_hold ? 'Payout hold active' : 'No fraud hold'}</p></article>
    </section>

    <section className="finance-card"><div className="finance-heading"><div><span className="section-pill section-pill-yellow">Paid publishing</span><h2>Ticketing state</h2></div><button disabled={loading || !account?.charges_enabled || !account?.payouts_enabled} onClick={() => submit('set_paid_ticketing', { enabled: !event.paid_ticketing_enabled })}>{event.paid_ticketing_enabled ? 'Disable paid ticketing' : 'Enable paid ticketing'}</button></div><p>Enabling ticketing does not publish the event. Publication still passes payout, inventory, moderation, and event-field checks.</p></section>

    <section className="finance-card"><div className="finance-heading"><div><span className="section-pill section-pill-mint">Inventory</span><h2>Ticket tiers</h2></div><Link href={`/studio/events/${eventId}/check-in`}>Open scanner →</Link></div>
      <div className="finance-list">{(dashboard.tiers || []).map((tier) => <div key={tier.id}><span>{tier.status}</span><strong>{tier.name}</strong><small>{money(tier.price_cents, tier.currency)} · {tier.quantity_sold}/{tier.quantity_total} sold</small><button className="quiet-button" disabled={loading || tier.status === 'archived'} onClick={() => submit('archive_tier', { ticketTypeId: tier.id })}>Archive</button></div>)}</div>
      <form className="finance-form-grid" onSubmit={(event) => { event.preventDefault(); const f = new FormData(event.currentTarget); submit('upsert_tier', Object.fromEntries(f)); event.currentTarget.reset() }}>
        <label>Name<input name="name" required maxLength="80" placeholder="General admission" /></label><label>Price cents<input name="priceCents" type="number" min="50" required placeholder="2500" /></label><label>Quantity<input name="quantityTotal" type="number" min="1" required /></label><label>Max per order<input name="maxPerOrder" type="number" min="1" max="20" defaultValue="6" /></label><label>Per-customer limit<input name="perCustomerLimit" type="number" min="1" max="50" defaultValue="10" /></label><label>Sales start<input name="salesStart" type="datetime-local" /></label><label>Sales end<input name="salesEnd" type="datetime-local" /></label><label className="span-two">Description<textarea name="description" maxLength="500" /></label><button disabled={loading} type="submit">Add ticket tier</button>
      </form>
    </section>

    <section className="finance-card"><span className="section-pill">Promo codes</span><h2>Discount controls</h2><div className="finance-list">{(dashboard.promos || []).map((promo) => <div key={promo.id}><span>{promo.active ? 'active' : 'inactive'}</span><strong>{promo.code}</strong><small>{promo.percent_off ? `${promo.percent_off}% off` : money(promo.amount_off_cents, event.currency)} · {promo.redemption_count}/{promo.max_redemptions || '∞'}</small></div>)}</div><form className="finance-form-grid" onSubmit={(event) => { event.preventDefault(); const f = new FormData(event.currentTarget); submit('create_promo', Object.fromEntries(f)); event.currentTarget.reset() }}><label>Code<input name="code" required pattern="[A-Za-z0-9_-]{3,32}" /></label><label>Percent off<input name="percentOff" type="number" min="1" max="100" /></label><label>Amount off cents<input name="amountOffCents" type="number" min="1" /></label><label>Maximum uses<input name="maxRedemptions" type="number" min="1" /></label><button type="submit" disabled={loading}>Create promo</button></form></section>

    <section className="finance-card"><span className="section-pill section-pill-yellow">Refunds</span><h2>Requests awaiting review</h2><div className="finance-list">{(dashboard.refunds || []).length ? dashboard.refunds.map((refund) => <div key={refund.id}><span>{refund.status}</span><strong>{money(refund.amount_cents, refund.currency)} · {refund.reason}</strong><small>{refund.requester?.display_name || refund.requester?.username || 'Buyer'}</small>{refund.status === 'requested' ? <div><button disabled={loading} onClick={() => submit('decide_refund', { refundId: refund.id, decision: 'approve' })}>Approve</button><button className="quiet-button" disabled={loading} onClick={() => submit('decide_refund', { refundId: refund.id, decision: 'decline' })}>Decline</button></div> : null}</div>) : <p>No open refund requests.</p>}</div></section>

    <section className="finance-card"><span className="section-pill section-pill-mint">Ledger</span><h2>Reconciliation snapshot</h2><dl className="finance-facts"><div><dt>Gross</dt><dd>{money(dashboard.ledger?.gross_cents, event.currency)}</dd></div><div><dt>Seller payable</dt><dd>{money(dashboard.ledger?.seller_payable_cents, event.currency)}</dd></div><div><dt>Platform fees</dt><dd>{money(dashboard.ledger?.platform_fee_cents, event.currency)}</dd></div><div><dt>Refunds</dt><dd>{money(dashboard.ledger?.refund_cents, event.currency)}</dd></div></dl></section>
  </div>
}
