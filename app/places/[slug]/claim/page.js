import sharedUIStyles from "@/components/shared-ui.module.css"
import { scopedClasses } from "@/components/scoped-classes"
import { notFound } from 'next/navigation'
import { AuthMessage } from '@/components/auth-message'
import { LocationClaimForm } from '@/components/location-claim-form'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getCreatorOptions } from '@/lib/app/creator-data'
import { getPublicLocation } from '@/lib/app/public-content'
import { submitLocationClaim } from '@/app/(product)/create/actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Claim location', robots: { index: false, follow: false } }

export default async function ClaimLocationPage({ params, searchParams }) {
  const { slug } = await params
  const messages = await searchParams
  const result = await getPublicLocation(slug)
  if (!result) notFound()
  return renderProductPage(async (session) => {
    const options = await getCreatorOptions(session)
    return <><div className={scopedClasses(sharedUIStyles, "page-heading-row")}><div><span className="section-pill section-pill-mint">Location claim</span><h1 className={scopedClasses(sharedUIStyles, "product-title")}>Manage {result.location.name}.</h1><p>Claims attach management rights to your existing user account or a host profile you already manage.</p></div></div><AuthMessage searchParams={messages} /><LocationClaimForm action={submitLocationClaim} location={result.location} displayName={session.profile.display_name} hosts={options.hosts} /></>
  })
}
