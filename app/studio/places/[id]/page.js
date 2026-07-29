import { AuthMessage } from '@/components/auth-message'
import { LocationEditor } from '@/components/location-editor'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getCreatorOptions, getEditableLocation } from '@/lib/app/creator-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Edit location' }

export default async function EditLocationPage({ params, searchParams }) {
  const { id } = await params
  const messages = await searchParams
  return renderProductPage(async (session) => {
    const [location, options] = await Promise.all([getEditableLocation(session.supabase, id), getCreatorOptions(session)])
    return <><div className="page-heading-row"><div><span className="section-pill section-pill-mint">Location studio</span><h1 className="product-title">{location.name}</h1><p>Keep hours and access details current, preview the page, and publish through review.</p></div></div><AuthMessage searchParams={messages} /><LocationEditor location={location} {...options} /></>
  })
}
