import Link from 'next/link'
import { renderProductPage } from '@/lib/app/render-product-page'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Create a puddle' }

function profilePhotoUrl(session, path) {
  if (!path) return null
  const value = String(path)
  if (value.startsWith('/') || /^https?:\/\//i.test(value)) return value
  return session.supabase.storage.from('puddle-public-media').getPublicUrl(value).data.publicUrl
}

function initials(name) {
  return String(name || 'P').split(/\s+/).filter(Boolean).slice(0,2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}

export default async function CreatePostPage() {
  return renderProductPage(async (session) => {
    const avatar = profilePhotoUrl(session, session.profile?.avatar_path)
    const name = session.profile?.display_name || 'Puddle person'

    return <div className="figma-create-post-screen">
      <Link className="figma-feed-back" href="/map" aria-label="Back to Feed">‹</Link>
      <nav className="figma-dashboard-segment figma-feed-tabs" aria-label="Feed or map"><Link className="is-active" href="/map">Feed</Link><Link href="/map?view=map">Map</Link></nav>

      <article className="figma-create-post-blur" aria-hidden="true">
        <span className="figma-feed-post-avatar" style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}>{avatar ? null : initials(name)}</span>
        <strong>{name}</strong>
      </article>

      <form className="figma-create-post-card" aria-label="Create a puddle post">
        <span className="figma-feed-post-avatar" style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}>{avatar ? null : initials(name)}</span>
        <fieldset className="figma-create-post-visibility"><legend className="sr-only">Who can see this post?</legend><label><input type="radio" name="visibility" value="public" defaultChecked /><span>Public</span></label><label><input type="radio" name="visibility" value="friends" /><span>Friends Only</span></label></fieldset>
        <button className="figma-create-post-submit" type="button" disabled aria-label="Post publishing is not enabled yet">↑</button>
        <label className="figma-create-post-title"><span className="sr-only">Title</span><input name="title" maxLength="80" placeholder="Title" /></label>
        <label className="figma-create-post-description"><span className="sr-only">Description</span><textarea name="description" maxLength="1000" placeholder="Description" /></label>
        <label className="figma-create-post-photo"><input type="file" accept="image/jpeg,image/png,image/webp" multiple /><span>＋</span></label>
        <Link className="figma-create-post-map" href="/map?view=map" aria-label="Choose a place from the map">⌑</Link>
        <small className="figma-create-post-note">Post publishing is not connected to a backend yet. The composer UI is ready without pretending a post was saved.</small>
      </form>
    </div>
  })
}
