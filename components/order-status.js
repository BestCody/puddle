"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'

export function OrderStatus({ initialOrder }) {
  const [order, setOrder] = useState(initialOrder)
  useEffect(() => {
    if (!['pending','checkout_created','payment_processing'].includes(order.status)) return
    const timer = setInterval(async () => {
      const response = await fetch(`/api/stripe/order/${order.id}/status`, { cache: 'no-store' })
      if (response.ok) { const result = await response.json(); setOrder(result.order) }
    }, 3000)
    return () => clearInterval(timer)
  }, [order.id, order.status])
  const paid = ['paid','partially_refunded','refunded'].includes(order.status)
  return <section className="finance-card order-status-card"><span className={`finance-status ${paid ? 'is-ready' : 'is-pending'}`}>{order.status.replaceAll('_', ' ')}</span><h1>{paid ? 'Payment confirmed.' : order.status === 'payment_review' ? 'Payment under review.' : 'Waiting for verified payment confirmation.'}</h1><p>{paid ? 'Your signed tickets are ready in the wallet.' : 'This page never creates tickets. Puddle waits for Stripe’s verified server-to-server event.'}</p><div className="finance-actions">{paid ? <Link className="splash-button splash-button-mint" href="/wallet">Open ticket wallet</Link> : null}<Link className="quiet-button" href={`/events/${order.events?.slug}`}>Back to event</Link></div></section>
}
