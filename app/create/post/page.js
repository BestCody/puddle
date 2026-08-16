import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getLocationMapSnapshot } from '@/lib/app/location-map-data'
import { createPuddlePost } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Create a puddle' }

function profilePhotoUrl(session, path) {
  if (!path) return null
  const value = String(path)
  if (value.startsWith('/') || /^https?:\/\//i.test(value)) return value
  return session.supabase.storage.from('puddle-public-media').getPublicUrl(value).data.publicUrl
}

function initials(name) {
  return String(name || 'P').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}

function categoryLabel(value) {
  return String(value || 'Park').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function CreatePostPreview({ avatar, name, point }) {
  const title = point?.title || 'Choose a saved place'
  const category = categoryLabel(point?.category)
  const location = point?.city || point?.neighborhood || 'Your Puddle'
  const copy = point?.summary || 'Pick a place below, add a title and description, then publish it to your feed.'
  const photoStyle = point?.photo_url ? { backgroundImage: `url(${point.photo_url})` } : undefined

  return <article className="figma-create-post-blur" aria-hidden="true">
    <span className="figma-create-post-preview-avatar" style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}>{avatar ? null : initials(name)}</span>
    <strong className="figma-create-post-preview-name">{name}</strong>
    <small className="figma-create-post-preview-time">New puddle</small>
    <p className="figma-create-post-preview-copy">{copy}</p>

    <div className="figma-create-post-preview-photos">
      <i className="is-main" style={photoStyle} />
      {point?.photo_url ? <i style={photoStyle} /> : <i />}
      <i className="is-more">{point ? 'Place' : '+'}</i>
    </div>

    <div className="figma-create-post-preview-place">
      <span>{category}</span>
      <small>{location}</small>
      <h2>{title}</h2>
      <b>+</b>
    </div>

    <footer className="figma-create-post-preview-actions"><span>◯</span><span>◒</span><span>♡</span><span>↗</span></footer>
  </article>
}

export default async function CreatePostPage({ searchParams }) {
  const params = await searchParams
  return renderProductPage(async (session) => {
    const avatar = profilePhotoUrl(session, session.profile?.avatar_path)
    const name = session.profile?.display_name || 'Puddle person'
    const snapshot = await getLocationMapSnapshot(session)
    const requestedLocation = typeof params?.location === 'string' ? params.location : null
    const selectedPoint = snapshot.points.find((point) => point.id === requestedLocation) || snapshot.points[0] || null

    return <div className="figma-create-post-screen">
      <AuthMessage searchParams={params} />
      <Link className="figma-feed-back" href="/map" aria-label="Back to Feed">‹</Link>
      <nav className="figma-dashboard-segment figma-feed-tabs" aria-label="Feed or map">
        <Link className="is-active" href="/map">Feed</Link>
        <Link href="/map?view=map">Map</Link>
      </nav>
      <form className="figma-feed-search figma-create-post-search" action="/plans" method="get">
        <label><input aria-label="Search saved puddles" type="search" name="q" placeholder="Search saved puddles" /></label>
        <button type="submit" aria-label="Search">⌕</button>
      </form>

      <CreatePostPreview avatar={avatar} name={name} point={selectedPoint} />

      <form className="figma-create-post-card" aria-label="Create a puddle post" action={createPuddlePost}>
        <input type="hidden" name="location_id" value={selectedPoint?.id || ''} />
        <span className="figma-feed-post-avatar" style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}>{avatar ? null : initials(name)}</span>
        <fieldset className="figma-create-post-visibility" aria-label="Post visibility">
          <label><input type="radio" name="visibility" value="public" defaultChecked /><span>Public</span></label>
          <label><input type="radio" name="visibility" value="friends" /><span>Friends Only</span></label>
        </fieldset>
        <button className="figma-create-post-submit" type="submit" disabled={!selectedPoint} aria-label="Publish post">↑</button>
        <label className="figma-create-post-title"><input aria-label="Title" name="title" maxLength="80" required placeholder="Title" /></label>
        <label className="figma-create-post-description"><textarea aria-label="Description" name="description" maxLength="1000" placeholder="Description" /></label>
        <details className="figma-create-post-add">
          <summary aria-label="Choose a saved place">＋</summary>
          <div className="figma-create-post-add-menu">
            <strong>Attach a saved place</strong>
            {snapshot.points.length ? <div className="figma-create-post-location-options">
              {snapshot.points.slice(0, 12).map((point) => <Link
                className={selectedPoint?.id === point.id ? 'is-selected' : ''}
                href={`/create/post?location=${encodeURIComponent(point.id)}`}
                key={point.id}
              ><span>{point.title}</span><small>{point.city || categoryLabel(point.category)}</small></Link>)}
            </div> : <p>Save a place first, then come back to create a puddle.</p>}
          </div>
          <div className="figma-create-post-add-footer"><span>{selectedPoint ? selectedPoint.title : 'No place selected'}</span></div>
        </details>
        <Link className="figma-create-post-map" href="/map?view=map&selectForPost=1" aria-label="Choose a place from the map">⌑</Link>
      </form>

      {!selectedPoint ? <div className="figma-create-post-empty"><strong>You need a saved place before you can post.</strong><Link href="/discover">Start swiping</Link></div> : null}
    </div>
  })
}
