import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { LocationEditor } from '@/components/location-editor'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getCreatorOptions } from '@/lib/app/creator-data'
import { getMembershipSnapshot } from '@/lib/app/membership-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Add location' }

export default async function CreatePlacePage({ searchParams }) {
  const params = await searchParams
  return renderProductPage(async (session) => {
    const [options, membership] = await Promise.all([
      getCreatorOptions(session),
      getMembershipSnapshot(session)
    ])
    return <>
      <div className="page-heading-row">
        <div>
          <span className="section-pill section-pill-mint">New location</span>
          <h1 className="product-title">Put a local gem on Puddle.</h1>
          <p>Add accurate hours, amenities, access details, and contact information.</p>
        </div>
      </div>
      <AuthMessage searchParams={params} />
      {membership.active ? <LocationEditor {...options} /> : <section className="pass-location-create-lock">
        <span>PASS</span>
        <h2>Create your location</h2>
        <p>Adding a new place to Puddle is included with Puddle Pass.</p>
        <Link href="/membership">View Pass</Link>
      </section>}
    </>
  })
}
