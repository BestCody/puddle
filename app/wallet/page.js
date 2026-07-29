import { TicketWallet } from '@/components/ticket-wallet'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getWallet } from '@/lib/app/ticketing-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ticket wallet' }

export default async function WalletPage() {
  return renderProductPage(async (session) => {
    const snapshot = await getWallet(session)
    return <><section className="page-heading-row"><div><span className="section-pill section-pill-mint">Ticket wallet</span><h1 className="product-title">Your tickets, ready at the door.</h1><p>Signed QR tickets appear only after Stripe confirms payment through a verified webhook.</p></div></section><TicketWallet snapshot={snapshot} currentUserId={session.user.id}/></>
  })
}
