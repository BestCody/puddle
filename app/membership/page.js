import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getMembershipSnapshot } from '@/lib/app/membership-data'
import { openMembershipPortal, saveGlobalPreference, startTinderCheckout } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Membership' }

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
    const checkoutNotice = params?.checkout === 'success'
      ? 'Payment received. Your tier will unlock as soon as Stripe confirms the subscription.'
      : params?.checkout === 'canceled'
        ? 'Checkout was canceled. Your Free tier is unchanged.'
        : null
    const periodEnd = periodLabel(snapshot.membership?.current_period_end)

    return <div className="membership-page">
      <header className="minimal-page-header">
        <div><h1>Membership</h1><p>Two simple tiers. Upgrade only for global connections.</p></div>
        {snapshot.active ? <Link href="/global-matches">Global likes</Link> : null}
      </header>

      <AuthMessage searchParams={searchParams} />
      {checkoutNotice ? <p className="membership-notice">{checkoutNotice}</p> : null}

      <section className="tier-grid" aria-label="Puddle membership tiers">
        <article className={`tier-card ${snapshot.active ? '' : 'is-current'}`}>
          <div className="tier-heading"><span>Free</span>{snapshot.active ? null : <small>Current</small>}</div>
          <h2>$0</h2>
          <p>Keep the complete swipe-first Puddle experience.</p>
          <ul>
            <li>Nearby twelve-place decks</li>
            <li>Pass, Save, and Perfect Pick</li>
            <li>Saved places, plans, and DateMatch</li>
          </ul>
        </article>

        <article className={`tier-card tier-card-paid ${snapshot.active ? 'is-current' : ''}`}>
          <div className="tier-heading"><span>Tinder tier</span>{snapshot.active ? <small>Current</small> : <small>Paid</small>}</div>
          <h2>Monthly</h2>
          <p>Meet people worldwide through places you both genuinely liked.</p>
          <ul>
            <li>See opt-in adults who liked the same location</li>
            <li>Send a date, hangout, or either message request</li>
            <li>Message after the other person accepts</li>
          </ul>
          {!snapshot.adult ? <p className="tier-requirement">Global connections are limited to users age 18 or older.</p> : null}
          {!snapshot.paymentsConfigured ? <p className="tier-requirement">Payments are not configured yet.</p> : null}
          {snapshot.active ? <form action={openMembershipPortal}><button className="membership-primary" type="submit">Manage billing</button></form> : <form action={startTinderCheckout}><button className="membership-primary" type="submit" disabled={!snapshot.adult || !snapshot.paymentsConfigured}>Continue to checkout</button></form>}
          <small className="tier-price-note">The exact price and renewal terms appear before payment.</small>
        </article>
      </section>

      {snapshot.active && snapshot.adult ? <section className="global-visibility-card">
        <div><span className="membership-kicker">Tinder tier privacy</span><h2>Global connections</h2><p>Off by default. Turn this on to appear only to paid adults who liked the same location. Your private passes and exact location are never shown.</p></div>
        <form action={saveGlobalPreference}>
          <label className="membership-toggle"><input type="checkbox" name="discoverable" defaultChecked={snapshot.preference.discoverable} /><span>Let matching people find me</span></label>
          <label>What are you open to?<select name="intent" defaultValue={snapshot.preference.intent}><option value="either">Date or hangout</option><option value="date">Date</option><option value="hangout">Hangout</option></select></label>
          <button className="membership-primary" type="submit">Save privacy setting</button>
        </form>
        {snapshot.preference.discoverable ? <Link className="membership-secondary" href="/global-matches">Open global likes →</Link> : null}
      </section> : null}

      {snapshot.active ? <footer className="membership-status"><span>Status: {snapshot.membership.status}</span>{periodEnd ? <span>{snapshot.membership.cancel_at_period_end ? 'Ends' : 'Renews'} {periodEnd}</span> : null}</footer> : null}
    </div>
  })
}
