import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PuddleLogo } from '@/components/puddle-logo'
import { getMembershipSnapshot } from '@/lib/app/membership-data'
import { requireUser } from '@/lib/auth/user'
import { pathWithMessage } from '@/lib/auth/redirect'
import { startTinderCheckout } from '../actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Checkout' }

const MONTHLY_PRICE = '$10.00'

function membershipError(message) {
  return pathWithMessage('/membership', 'error', message)
}

export default async function MembershipCheckoutPage() {
  const session = await requireUser({ onboarding: true })
  const snapshot = await getMembershipSnapshot(session)

  if (snapshot.active) redirect('/global-matches')
  if (!snapshot.adult) redirect(membershipError('Tinder tier global connections require users to be at least 18.'))
  if (!snapshot.paymentsConfigured) redirect(membershipError('Payments are not configured yet.'))

  const displayName = session.profile?.display_name || 'Puddle member'
  const email = session.user?.email || ''

  return <main className="membership-checkout-page">
    <section className="membership-checkout-main">
      <div className="membership-checkout-wrap">
        <header className="membership-checkout-topbar">
          <Link className="membership-checkout-back" href="/membership" aria-label="Back to membership">←</Link>
          <div className="membership-checkout-brand"><PuddleLogo href="/discover" /></div>
        </header>

        <div className="membership-checkout-heading">
          <div>
            <span>Membership checkout</span>
            <h1>Upgrade to Tinder tier</h1>
            <p>Meet people worldwide through places you both genuinely liked.</p>
          </div>
          <div className="membership-checkout-price">
            <small>Monthly subscription</small>
            <strong>{MONTHLY_PRICE}</strong>
          </div>
        </div>

        <div className="membership-checkout-trust" aria-label="Checkout details">
          <span>Secure Stripe checkout</span>
          <span>Billed monthly</span>
          <span>Promotion codes supported</span>
        </div>

        <section className="membership-checkout-card" aria-labelledby="payment-methods-title">
          <div className="membership-checkout-section">
            <h2 id="payment-methods-title">Payment methods</h2>
            <p className="membership-checkout-section-copy">Stripe will show the payment methods available for your device and account on the secure payment step.</p>

            <div className="membership-payment-methods" aria-label="Common eligible payment methods">
              <div className="membership-payment-logo membership-payment-logo-apple" aria-label="Apple Pay when eligible">
                <img src="https://upload.wikimedia.org/wikipedia/commons/f/fa/Apple_logo_black.svg" alt="Apple" />
              </div>
              <div className="membership-payment-logo membership-payment-logo-google" aria-label="Google Pay when eligible">
                <img src="https://www.gstatic.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png" alt="Google" />
              </div>
              <div className="membership-payment-card-option" aria-label="Credit or debit card">
                <span className="membership-card-symbol" aria-hidden="true" />
                <div><strong>Card</strong><small>Visa · Mastercard · American Express</small></div>
              </div>
            </div>
          </div>

          <div className="membership-checkout-section">
            <h2>Account</h2>
            <div className="membership-checkout-account">
              <div><strong>{displayName}</strong><small>{email}</small></div>
              <Link href="/profile">Change</Link>
            </div>
          </div>

          <div className="membership-checkout-section membership-checkout-promo">
            <div><h2>Promotion code</h2><p>Enter a promotion code on the Stripe payment step.</p></div>
            <span>Accepted</span>
          </div>
        </section>

        <form action={startTinderCheckout}>
          <button className="membership-checkout-submit" type="submit">Continue to secure payment</button>
        </form>
        <p className="membership-checkout-legal">By continuing, you agree to Puddle&apos;s <Link href="/terms">Terms of Service</Link> and <Link href="/privacy">Privacy Policy</Link>. Stripe will show the final renewal and payment details before you subscribe.</p>
      </div>
    </section>

    <aside className="membership-checkout-summary" aria-label="Order summary">
      <div className="membership-checkout-summary-wrap">
        <h2>Order summary</h2>
        <section className="membership-order-card">
          <div className="membership-order-head">
            <div className="membership-order-mark"><img src="/puddle-mark.svg" alt="" /></div>
            <div><strong>Tinder tier</strong><span>Puddle membership · monthly</span></div>
            <b>{MONTHLY_PRICE}</b>
          </div>

          <div className="membership-order-features">
            <div><span>•</span><p><strong>Global connections</strong><small>Meet opt-in adults worldwide through places you both liked.</small></p><i>✓</i></div>
            <div><span>•</span><p><strong>Shared-place matches</strong><small>See adults who liked the same location.</small></p><i>✓</i></div>
            <div><span>•</span><p><strong>Date or hangout requests</strong><small>Send a date, hangout, or either request.</small></p><i>✓</i></div>
            <div><span>•</span><p><strong>Messaging after acceptance</strong><small>Chat once the other person accepts.</small></p><i>✓</i></div>
          </div>

          <div className="membership-order-total">
            <div><span>Monthly membership</span><strong>{MONTHLY_PRICE}</strong></div>
            <div><span>Taxes and final amount</span><span>Shown by Stripe</span></div>
            <div className="membership-order-total-line"><span>Subscription</span><strong>{MONTHLY_PRICE} / month</strong></div>
          </div>
        </section>
        <p className="membership-stripe-note">Secure payment processing by Stripe</p>
      </div>
    </aside>
  </main>
}
