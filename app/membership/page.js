import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getMembershipSnapshot } from '@/lib/app/membership-data'
import { openMembershipPortal, saveGlobalPreference, startTinderCheckout } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Pass' }

const TINDER_TIER_MONTHLY_PRICE = '$10/month'

function periodLabel(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium' }).format(date)
}

export default async function MembershipPage({ searchParams }) {
  return renderProductPage(async (session) => {
    const snapshot = await getMembershipSnapshot(session)
    const params = await searchParams
    const view = params?.view === 'manage' ? 'manage' : 'plans'
    const checkoutNotice = params?.checkout === 'success'
      ? 'Payment received. Your Pass will unlock as soon as Stripe confirms the subscription.'
      : params?.checkout === 'canceled'
        ? 'Checkout was canceled. Your Free plan is unchanged.'
        : null
    const periodEnd = periodLabel(snapshot.membership?.current_period_end)

    return <div className="membership-page figma-pass-page">
      <nav className="figma-segmented-tabs figma-pass-segment" aria-label="Pass sections">
        <Link className={view === 'plans' ? 'is-active' : ''} href="/membership">Plans</Link>
        <Link className={view === 'manage' ? 'is-active' : ''} href="/membership?view=manage">Manage</Link>
      </nav>

      <AuthMessage searchParams={params} />
      {checkoutNotice ? <p className="membership-notice">{checkoutNotice}</p> : null}

      {view === 'plans' ? <>
        <h1 className="figma-pass-title"><span>puddle</span> Membership</h1>
        <section className="tier-grid figma-pass-grid" aria-label="Puddle membership tiers">
          <article className={`tier-card figma-pass-card figma-pass-free ${snapshot.active ? '' : 'is-current'}`}>
            <div className="figma-pass-price"><span>Free</span><strong>$0</strong></div>
            <div className="figma-pass-features">
              <p>Swipe nearby places, save favorites, plan outings, and coordinate with friends.</p>
            </div>
            {snapshot.active ? <span className="figma-plan-state">Available</span> : <span className="figma-plan-state is-current">Current</span>}
          </article>

          <article className={`tier-card figma-pass-card figma-pass-paid ${snapshot.active ? 'is-current' : ''}`}>
            <span className="sr-only">Tinder tier</span>
            <div className="figma-pass-price"><span>Pass</span><strong>{TINDER_TIER_MONTHLY_PRICE}</strong></div>
            <div className="figma-pass-features">
              <p>Meet opt-in adults worldwide through places you both genuinely liked.</p>
              {!snapshot.adult ? <small>Pass connections are limited to users age 18 or older.</small> : null}
              {!snapshot.paymentsConfigured ? <small>Payments are not configured yet.</small> : null}
            </div>
            {snapshot.active
              ? <Link className="figma-pass-cta" href="/membership?view=manage">Manage</Link>
              : snapshot.adult && snapshot.paymentsConfigured
                ? <form action={startTinderCheckout}><button className="figma-pass-cta" type="submit">Upgrade</button></form>
                : <button className="figma-pass-cta" type="button" disabled>Upgrade</button>}
          </article>
        </section>
        <p className="figma-pass-disclosure">Pass is the $10/month Tinder tier entitlement. Taxes and renewal terms appear before payment.</p>
      </> : <section className="figma-pass-manage">
        <header><span>Pass</span><h1>Manage membership</h1><p>Billing, privacy, and global connection controls.</p></header>
        {snapshot.active ? <>
          <div className="figma-manage-card">
            <div><small>Subscription</small><strong>{snapshot.membership.status}</strong>{periodEnd ? <span>{snapshot.membership.cancel_at_period_end ? 'Ends' : 'Renews'} {periodEnd}</span> : null}</div>
            <form action={openMembershipPortal}><button className="membership-primary" type="submit">Manage billing</button></form>
          </div>
          {snapshot.adult ? <div className="figma-manage-card global-visibility-card">
            <div><small>Privacy</small><h2>Global connections</h2><p>Off by default. Appear only to paid adults who liked the same location. Private passes and exact location stay private.</p></div>
            <form action={saveGlobalPreference}>
              <label className="membership-toggle"><input type="checkbox" name="discoverable" defaultChecked={snapshot.preference.discoverable} /><span>Let matching people find me</span></label>
              <label>What are you open to?<select name="intent" defaultValue={snapshot.preference.intent}><option value="either">Date or hangout</option><option value="date">Date</option><option value="hangout">Hangout</option></select></label>
              <button className="membership-primary" type="submit">Save privacy setting</button>
            </form>
            {snapshot.preference.discoverable ? <Link className="membership-secondary" href="/global-matches">Open global likes →</Link> : null}
          </div> : null}
        </> : <div className="figma-manage-card is-empty"><h2>You are on Free.</h2><p>Upgrade to Pass to unlock global connections and billing management.</p><Link className="membership-primary" href="/membership">See plans</Link></div>}
      </section>}
    </div>
  })
}
