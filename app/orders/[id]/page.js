import { notFound } from 'next/navigation'
import { OrderStatus } from '@/components/order-status'
import { renderProductPage } from '@/lib/app/render-product-page'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Order status' }

export default async function OrderPage({ params }) {
  const { id } = await params
  return renderProductPage(async (session) => {
    const { data: order } = await session.supabase.from('orders').select('id,status,event_id,amount_total_cents,currency,paid_at,events(title,slug)').eq('id', id).eq('buyer_id', session.user.id).maybeSingle()
    if (!order) notFound()
    return <OrderStatus initialOrder={order}/>
  })
}
