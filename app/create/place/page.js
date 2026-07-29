import { AuthMessage } from '@/components/auth-message'
import { LocationEditor } from '@/components/location-editor'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getCreatorOptions } from '@/lib/app/creator-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Add location' }

export default async function CreatePlacePage({ searchParams }) {
  const params = await searchParams
  return renderProductPage(async (session) => {
    const options = await getCreatorOptions(session)
    return <><div className="page-heading-row"><div><span className="section-pill section-pill-mint">New location</span><h1 className="product-title">Put a local gem on Puddle.</h1><p>Add accurate hours, amenities, access details, and contact information.</p></div></div><AuthMessage searchParams={params} /><LocationEditor {...options} /></>
  })
}
