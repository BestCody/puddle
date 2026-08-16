import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getMembershipSnapshot } from '@/lib/app/membership-data'
import { openMembershipPortal, startTinderCheckout } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Pass' }

const PASS_MONTHLY_PRICE = '$10/month'

function periodLabel(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' }).format(date)
}

function PassTabs({ view }) {
  return <nav className="figma-dashboard-segment figma-pass-tabs" aria-label="Pass sections">
    <Link className={view === 'plans' ? 'is-active' : ''} href="/membership">Plans</Link>
    <Link className={view === 'manage' ? 'is-active' : ''} href="/membership?view=manage">Manage</Link>
  </nav>
}

function PlansView({ snapshot }) {
  return <>
    <h1 className="figma-pass-heading"><span>puddle</span> Membership</h1>
    <section className="figma-pass-plan-grid" aria-label="Puddle membership tiers">
      <article className="figma-pass-plan figma-pass-plan-free">
        <div className="figma-pass-plan-price"><span>Free</span><strong>$0</strong></div>
        <ul><li>Swipe</li><li>Feed</li><li>Map</li><li>Message friends only</li></ul>
        {snapshot.active ? <span className="figma-pass-plan-state">Available</span> : <span className="figma-pass-plan-state">Current</span>}
      </article>

      <article className="figma-pass-plan figma-pass-plan-paid">
        <div className="figma-pass-plan-price"><span>Pass</span><strong>{PASS_MONTHLY_PRICE}</strong><s>$15/month</s></div>
        <div className="figma-pass-plan-features">
          <p>Everything in Free plus...</p>
          <ul><li>Heatmap</li><li>Pass badge</li><li>Create your location</li><li>Message anyone</li><li>See who saved</li><li>Notification alerts</li></ul>
        </div>
        {snapshot.active
          ? <Link className="figma-pass-upgrade" href="/membership?view=manage">Manage</Link>
          : snapshot.adult && snapshot.paymentsConfigured
            ? <form action={startTinderCheckout}><button className="figma-pass-upgrade" type="submit">Upgrade</button></form>
            : <button className="figma-pass-upgrade" type="button" disabled>Upgrade</button>}
      </article>
    </section>
  </>
}

function ManageView({ snapshot }) {
  const periodEnd = periodLabel(snapshot.membership?.current_period_end)
  return <section className={`figma-pass-manage-screen ${snapshot.active ? 'is-paid' : 'is-free'}`}>
    <article className="figma-pass-current-plan">
      <small>Current{snapshot.active ? ' Plan' : ''}</small>
      <strong>{snapshot.active ? 'Pass / $10' : 'Free'}</strong>
      {snapshot.active && periodEnd ? <span>{snapshot.membership.cancel_at_period_end ? 'Ends' : 'Renews'} {periodEnd}</span> : null}
    </article>

    <div className="figma-pass-manage-actions">
      {snapshot.active ? <>
        <form action={openMembershipPortal}><button className="is-dark" type="submit">AutoPay</button></form>
        <form action={openMembershipPortal}><button type="submit">Cancel</button></form>
      </> : snapshot.adult && snapshot.paymentsConfigured
        ? <form action={startTinderCheckout}><button className="is-upgrade" type="submit">Upgrade</button></form>
        : <button className="is-upgrade" type="button" disabled>Upgrade</button>}
    </div>

    <article className="figma-pass-history">
      {snapshot.active ? <>
        <strong>Transaction History</strong>
        <div className="figma-pass-history-row"><span>{periodEnd || 'Current period'}</span><span><b>Active</b> Puddle Pass</span></div>
        <form action={openMembershipPortal}><button type="submit">See All</button></form>
      </> : <p>No transaction history</p>}
    </article>
  </section>
}

export default async function MembershipPage({ searchParams }) {
  return renderProductPage(async (session) => {
    const snapshot = await getMembershipSnapshot(session)
    const params = await searchParams
    const view = params?.view === 'manage' ? 'manage' : 'plans'
    const checkoutNotice = params?.checkout === 'success'
      ? 'Payment received. Your Pass will unlock as soon as Stripe confirms the subscription.'
      : params?.checkout === 'canceled' ? 'Checkout was canceled. Your Free plan is unchanged.' : null

    return <div className="figma-pass-screen">
      <PassTabs view={view} />
      <AuthMessage searchParams={params} />
      {checkoutNotice ? <p className="figma-pass-notice">{checkoutNotice}</p> : null}
      {view === 'plans' ? <PlansView snapshot={snapshot} /> : <ManageView snapshot={snapshot} />}
    </div>
  })
}
