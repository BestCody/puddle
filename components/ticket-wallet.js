"use client"

import Link from 'next/link'
import { useState } from 'react'

function money(cents, currency = 'CAD') { return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(Number(cents || 0) / 100) }

export function TicketWallet({ snapshot, currentUserId }) {
  const [message, setMessage] = useState('')
  async function transfer(action, payload) {
    const response = await fetch('/api/tickets/transfer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...payload }) })
    const result = await response.json().catch(() => ({}))
    setMessage(response.ok ? 'Ticket transfer updated. Refresh to see the latest status.' : result.error || 'Transfer could not be updated.')
  }
  return <div className="wallet-stack">
    {message ? <p className="discovery-message">{message}</p> : null}
    <section className="wallet-grid">{snapshot.tickets.length ? snapshot.tickets.map((ticket) => <article className="wallet-ticket" key={ticket.id}>
      <span>{ticket.status.replaceAll('_', ' ')}</span><h2>{ticket.events?.title || 'Event ticket'}</h2><p>{ticket.ticket_types?.name} · {money(ticket.ticket_types?.price_cents, ticket.ticket_types?.currency)}</p><small>{ticket.events?.starts_at ? new Date(ticket.events.starts_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : ''}</small>
      <div className="wallet-actions"><Link href={`/wallet/tickets/${ticket.id}`}>Open ticket</Link><Link href={`/events/${ticket.events?.slug}`}>Event details</Link></div>
      {ticket.status === 'valid' ? <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); transfer('request', { ticketId: ticket.id, recipient: form.get('recipient') }); event.currentTarget.reset() }}><label>Transfer to username<input name="recipient" required placeholder="@friend" /></label><button type="submit">Send transfer</button></form> : null}
    </article>) : <div className="map-empty"><strong>No tickets yet.</strong><span>Paid tickets appear here only after Stripe confirms payment.</span></div>}</section>
    {snapshot.transfers.length ? <section className="finance-card"><h2>Transfers</h2><div className="finance-list">{snapshot.transfers.map((item) => <div key={item.id}><span>{item.status}</span><strong>{item.tickets?.events?.title || item.tickets?.ticket_number}</strong>{item.recipient_id === currentUserId && item.status === 'pending' ? <button onClick={() => transfer('accept', { transferId: item.id })}>Accept</button> : null}{item.status === 'pending' ? <button className="quiet-button" onClick={() => transfer('cancel', { transferId: item.id })}>Cancel</button> : null}</div>)}</div></section> : null}
    {snapshot.refunds.length ? <section className="finance-card"><h2>Refund requests</h2><div className="finance-list">{snapshot.refunds.map((refund) => <div key={refund.id}><span>{refund.status}</span><strong>{refund.orders?.events?.title || 'Order'}</strong><small>{money(refund.amount_cents)}</small></div>)}</div></section> : null}
  </div>
}
