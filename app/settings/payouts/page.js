import { PayoutOnboarding } from '@/components/payout-onboarding'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getPayoutStatus } from '@/lib/app/ticketing-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Payout settings' }

export default async function PayoutSettingsPage() {
  return renderProductPage(async (session) => {
    const account = await getPayoutStatus(session)
    return <><section className="page-heading-row"><div><span className="section-pill section-pill-yellow">Financial settings</span><h1 className="product-title">Get paid for hosted events.</h1><p>Stripe securely collects identity and bank details. Puddle never stores full bank-account information.</p></div></section><PayoutOnboarding initialAccount={account}/></>
  })
}
