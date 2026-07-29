"use client"

import { useState } from 'react'

export function PayoutOnboarding({ initialAccount }) {
  const [account, setAccount] = useState(initialAccount)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const ready = account?.charges_enabled && account?.payouts_enabled && !account?.fraud_hold

  async function onboard() {
    setLoading(true); setMessage('Opening Stripe onboarding…')
    const response = await fetch('/api/stripe/connect/onboard', { method: 'POST' })
    const result = await response.json().catch(() => ({}))
    setLoading(false)
    if (!response.ok || !result.url) { setMessage(result.error || 'Payout onboarding could not start.'); return }
    window.location.href = result.url
  }

  async function refresh() {
    setLoading(true)
    const response = await fetch('/api/stripe/connect/status', { cache: 'no-store' })
    const result = await response.json().catch(() => ({}))
    setLoading(false)
    if (!response.ok) { setMessage(result.error || 'Payout status could not refresh.'); return }
    setAccount(result.account); setMessage('Payout status refreshed.')
  }

  return <section className="finance-card payout-card">
    <span className={`finance-status ${ready ? 'is-ready' : 'is-pending'}`}>{ready ? 'Paid events unlocked' : 'Onboarding required'}</span>
    <h2>Stripe payout account</h2>
    <p>You remain a normal Puddle user. Stripe onboarding only unlocks the ability to publish paid events and receive ticket proceeds.</p>
    <dl className="finance-facts"><div><dt>Identity</dt><dd>{account?.identity_status || 'Not started'}</dd></div><div><dt>Payments</dt><dd>{account?.charges_enabled ? 'Enabled' : 'Pending'}</dd></div><div><dt>Payouts</dt><dd>{account?.payouts_enabled ? 'Enabled' : 'Pending'}</dd></div><div><dt>Hold</dt><dd>{account?.fraud_hold ? 'Review required' : 'None'}</dd></div></dl>
    {account?.requirements_due?.length ? <div className="privacy-note">Stripe still needs: {account.requirements_due.join(', ')}</div> : null}
    <div className="finance-actions"><button className="splash-button splash-button-yellow" type="button" onClick={onboard} disabled={loading}>{account ? 'Continue Stripe onboarding' : 'Start payout onboarding'}</button><button className="quiet-button" type="button" onClick={refresh} disabled={loading}>Refresh status</button></div>
    {message ? <p className="discovery-message">{message}</p> : null}
  </section>
}
