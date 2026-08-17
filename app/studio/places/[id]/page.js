import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { LocationEditor } from '@/components/location-editor'
import { MediaUploader } from '@/components/media-uploader'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getCreatorOptions, getEditableLocation } from '@/lib/app/creator-data'
import { getMembershipSnapshot } from '@/lib/app/membership-data'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Edit location' }

function avatarUrl(session, path) {
  if (!path) return null
  const value = String(path)
  if (value.startsWith('/') || /^https?:\/\//i.test(value)) return value
  return session.supabase.storage.from('puddle-public-media').getPublicUrl(value).data.publicUrl
}

function initials(name) {
  return String(name || 'P').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}

export default async function EditLocationPage({ params, searchParams }) {
  const { id } = await params
  const messages = await searchParams
  return renderProductPage(async (session) => {
    const [location, options, membership] = await Promise.all([
      getEditableLocation(session.supabase, id),
      getCreatorOptions(session),
      getMembershipSnapshot(session)
    ])

    let savers = []
    let saverCount = 0
    if (membership.active) {
      const cursorAt = String(messages?.savers_before || '').trim() || null
      const cursorProfile = String(messages?.savers_profile || '').trim() || null
      const [{ data: saverRows }, { data: count }] = await Promise.all([
        session.supabase.rpc('pass_location_savers_v2', {
          target_location: location.id,
          before_saved_at: cursorAt,
          before_profile_id: cursorProfile,
          result_limit: 50
        }),
        session.supabase.rpc('pass_location_saver_count_v2', { target_location: location.id })
      ])
      savers = saverRows || []
      saverCount = Number(count || 0)
    }
    const hasMoreSavers = savers.length === 50
    const saverCursor = savers[savers.length - 1] || null

    return <>
      <div className="page-heading-row">
        <div>
          <span className="section-pill section-pill-mint">Location studio</span>
          <h1 className="product-title">{location.name}</h1>
          <p>Keep hours, map coordinates, access details, and secure artwork current.</p>
        </div>
      </div>
      <AuthMessage searchParams={messages} />
      <section className="studio-media-grid">
        <MediaUploader purpose="location_cover" targetId={location.id} />
        <MediaUploader purpose="location_gallery" targetId={location.id} multiple />
      </section>

      {membership.active ? <section className="pass-location-savers" aria-label="People who saved this location">
        <header><span>PASS</span><div><h2>See who saved</h2><p>{saverCount} visible {saverCount === 1 ? 'person has' : 'people have'} saved this location.</p></div></header>
        {savers.length ? <div className="pass-location-saver-list">{savers.map((person) => {
          const photo = avatarUrl(session, person.avatar_path)
          const name = person.display_name || person.username || 'Puddle person'
          return <article key={person.id}>
            <span className="pass-location-saver-avatar" style={photo ? { backgroundImage: `url(${photo})` } : undefined}>{photo ? null : initials(name)}</span>
            <div><strong>{name}</strong>{person.username ? <small>@{person.username}</small> : null}</div>
          </article>
        })}</div> : <p className="pass-location-savers-empty">No visible savers on this page.</p>}
        {hasMoreSavers && saverCursor ? <Link href={`/studio/places/${encodeURIComponent(location.id)}?savers_before=${encodeURIComponent(saverCursor.saved_at)}&savers_profile=${encodeURIComponent(saverCursor.id)}`}>Next savers</Link> : null}
      </section> : <section className="pass-location-savers is-locked"><header><span>PASS</span><div><h2>See who saved</h2><p>Upgrade to see visible Puddle profiles that saved a location you manage.</p></div></header><Link href="/membership">View Pass</Link></section>}

      <LocationEditor location={location} {...options} />
    </>
  })
}
