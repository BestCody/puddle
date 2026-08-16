import Link from 'next/link'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getLocationMapSnapshot } from '@/lib/app/location-map-data'

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
  const title = point?.title || 'Maple Grove Park'
  const category = categoryLabel(point?.category)
  const location = point?.city || point?.neighborhood || 'Oakville'
  const copy = point?.summary || 'This place is amazing! The atmosphere is beautiful, the location feels welcoming, and there’s so much to see and do. Definitely a spot I’d come back to.'
  const photoStyle = point?.photo_url ? { backgroundImage: `url(${point.photo_url})` } : undefined

  return <article className="figma-create-post-blur" aria-hidden="true">
    <span className="figma-create-post-preview-avatar" style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}>{avatar ? null : initials(name)}</span>
    <strong className="figma-create-post-preview-name">{name}</strong>
    <small className="figma-create-post-preview-time">2 hours ago</small>
    <p className="figma-create-post-preview-copy">{copy}</p>

    <div className="figma-create-post-preview-photos">
      <i className="is-main" style={photoStyle} />
      <i style={photoStyle} />
      <i className="is-more">+30</i>
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

export default async function CreatePostPage() {
  return renderProductPage(async (session) => {
    const avatar = profilePhotoUrl(session, session.profile?.avatar_path)
    const name = session.profile?.display_name || 'Puddle person'
    const snapshot = await getLocationMapSnapshot(session)
    const previewPoint = snapshot.points[0] || null

    return <div className="figma-create-post-screen">
      <Link className="figma-feed-back" href="/map" aria-label="Back to Feed">‹</Link>
      <nav className="figma-dashboard-segment figma-feed-tabs" aria-label="Feed or map">
        <Link className="is-active" href="/map">Feed</Link>
        <Link href="/map?view=map">Map</Link>
      </nav>
      <form className="figma-feed-search figma-create-post-search" action="/map" method="get">
        <label><input aria-label="Search puddle" type="search" name="q" placeholder="Search puddle" /></label>
        <button type="submit" aria-label="Search">⌕</button>
      </form>

      <CreatePostPreview avatar={avatar} name={name} point={previewPoint} />

      <form className="figma-create-post-card" aria-label="Create a puddle post">
        <span className="figma-feed-post-avatar" style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}>{avatar ? null : initials(name)}</span>
        <fieldset className="figma-create-post-visibility" aria-label="Post visibility">
          <label><input type="radio" name="visibility" value="public" defaultChecked /><span>Public</span></label>
          <label><input type="radio" name="visibility" value="friends" /><span>Friends Only</span></label>
        </fieldset>
        <button className="figma-create-post-submit" type="button" disabled aria-label="Publish post">↑</button>
        <label className="figma-create-post-title"><input aria-label="Title" name="title" maxLength="80" placeholder="Title" /></label>
        <label className="figma-create-post-description"><textarea aria-label="Description" name="description" maxLength="1000" placeholder="Description" /></label>
        <details className="figma-create-post-add">
          <summary aria-label="Open add menu">＋</summary>
          <div className="figma-create-post-add-menu" aria-hidden="true" />
          <div className="figma-create-post-add-footer" aria-hidden="true" />
        </details>
        <Link className="figma-create-post-map" href="/map?view=map" aria-label="Choose a place from the map">⌑</Link>
      </form>
    </div>
  })
}
