import { notFound } from 'next/navigation'
import { AuthMessage } from '@/components/auth-message'
import { SubmitButton } from '@/components/submit-button'
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
    return <><div className="page-heading-row"><div><span className="section-pill section-pill-mint">Location claim</span><h1 className="product-title">Manage {result.location.name}.</h1><p>Claims attach management rights to your existing user account or a host profile you already manage.</p></div></div><AuthMessage searchParams={messages} /><form className="editor-card report-form" action={submitLocationClaim}><input type="hidden" name="location_id" value={result.location.id} /><input type="hidden" name="next" value={`/places/${slug}`} /><label className="editor-field">Claim as<select name="host_profile_id"><option value="">{session.profile.display_name} · personal</option>{options.hosts.map((host) => <option key={host.id} value={host.id}>{host.name} · {host.kind.replaceAll('_', ' ')}</option>)}</select></label><label className="editor-field">Your relationship<input name="relationship" required maxLength="120" placeholder="Owner, employee, venue manager, club organizer…" /></label><label className="editor-field">Verification link<input name="evidence_url" type="url" placeholder="Official website, directory, or public profile" /></label><label className="editor-field">Additional context<textarea name="note" maxLength="1200" /></label><SubmitButton>Submit claim →</SubmitButton></form></>
  })
}
