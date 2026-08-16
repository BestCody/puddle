import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { LocationMap } from '@/components/location-map'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getLocationMapSnapshot } from '@/lib/app/location-map-data'
import { getSocialFeedSnapshot } from '@/lib/app/social-feed-data'
import { createFeedComment, shareFeedPost, toggleFeedSave } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Feed and map',
  description: 'Browse Puddle posts or your saved places on the map.'
}

function initials(name) {
  return String(name || 'P').split(/\s+/).filter(Boolean).slice(0,2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}

function categoryLabel(value) {
  return String(value || 'Place').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function detailHref(point) {
  const slug = String(point.href || '').match(/^\/places\/(.+)$/)?.[1]
  return slug ? `/plans/${slug}` : point.href
}

function timeLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function FeedPhotos({ post, href }) {
  const photos = post.photo_urls || []
  if (!photos.length) return <Link href={href} className="figma-feed-post-photos figma-feed-post-photo-empty" aria-label={`Open ${post.location.name}`}><span>Puddle</span></Link>
  return <div className={`figma-feed-post-photos has-${Math.min(3, photos.length)}`} aria-label={`${post.location.name} photos`}>
    <Link href={href} className="is-main" style={{ backgroundImage: `url(${photos[0]})` }} aria-label={`Open ${post.location.name}`} />
    {photos[1] ? <Link href={href} style={{ backgroundImage: `url(${photos[1]})` }} aria-label={`Open ${post.location.name} photo 2`} /> : null}
    {photos[2] ? <Link href={href} className={photos.length > 3 ? 'is-more' : ''} style={{ backgroundImage: `url(${photos[2]})` }} aria-label={`Open ${post.location.name} photo 3`}>{photos.length > 3 ? `+${photos.length - 2}` : null}</Link> : null}
  </div>
}

function FeedPost({ post, friends }) {
  const author = post.author || {}
  const location = post.location
  const href = `/plans/${location.slug}`
  const authorName = author.display_name || author.username || 'Puddle person'
  return <article className="figma-feed-post" id={`post-${post.id}`}>
    <header className="figma-feed-post-author">
      <span className="figma-feed-post-avatar" style={post.author_avatar_url ? { backgroundImage: `url(${post.author_avatar_url})` } : undefined}>{post.author_avatar_url ? null : initials(authorName)}</span>
      <span><strong>{authorName}</strong><small>{timeLabel(post.created_at)} · {post.visibility === 'friends' ? 'Friends' : 'Public'}</small></span>
    </header>

    <h1 className="figma-feed-post-title">{post.title}</h1>
    {post.body ? <p className="figma-feed-post-copy">{post.body}</p> : null}

    <FeedPhotos post={post} href={href} />

    <Link className="figma-feed-post-place" href={href}>
      <span>{categoryLabel(location.kind)}</span>
      <small>{location.neighborhood || location.city || ''}</small>
      <h2>{location.name}</h2>
      <b aria-hidden="true">+</b>
    </Link>

    <footer className="figma-feed-post-interactions" aria-label="Post actions">
      <details className="figma-feed-action-menu figma-feed-comments">
        <summary aria-label={`Comment on ${post.title}`}>◯<span>{post.comments.length || ''}</span></summary>
        <div>
          {post.comments.length ? <div className="figma-feed-comment-list">{post.comments.map((comment) => <p key={comment.id}><strong>{comment.author?.display_name || comment.author?.username || 'Puddle person'}</strong><span>{comment.body}</span></p>)}</div> : <p>No comments yet.</p>}
          <form action={createFeedComment}>
            <input type="hidden" name="post_id" value={post.id} />
            <input name="comment_body" required maxLength="2000" placeholder="Add a comment" aria-label="Add a comment" />
            <button type="submit">Post</button>
          </form>
        </div>
      </details>
      <Link href={href} aria-label="Open puddle">◒</Link>
      <form action={toggleFeedSave}>
        <input type="hidden" name="location_id" value={post.location_id} />
        <button className={post.saved ? 'is-saved' : ''} type="submit" aria-label={post.saved ? `Remove ${location.name} from Saved` : `Save ${location.name}`}>{post.saved ? '♥' : '♡'}</button>
      </form>
      <details className="figma-feed-action-menu figma-feed-share">
        <summary aria-label={`Share ${post.title}`}>↗</summary>
        <div>
          <strong>Share with a friend</strong>
          {friends.length ? friends.map((friend) => <form action={shareFeedPost} key={friend.id}>
            <input type="hidden" name="post_id" value={post.id} />
            <input type="hidden" name="friend_id" value={friend.id} />
            <button type="submit">{friend.display_name || friend.username || 'Friend'}</button>
          </form>) : <p>Add a friend before sharing.</p>}
        </div>
      </details>
    </footer>
  </article>
}

function FeedTop({ view, query }) {
  return <>
    <Link className="figma-feed-back" href="/discover" aria-label="Back to Swipe">‹</Link>
    <nav className="figma-dashboard-segment figma-feed-tabs" aria-label="Feed or map">
      <Link className={view === 'feed' ? 'is-active' : ''} href="/map">Feed</Link>
      <Link className={view === 'map' ? 'is-active' : ''} href="/map?view=map">Map</Link>
    </nav>
    {view === 'feed' ? <form className="figma-feed-search" action="/map" method="get">
      <label><input aria-label="Search puddle" type="search" name="q" defaultValue={query || ''} placeholder="Search puddle" /></label>
      <button type="submit" aria-label="Search">⌕</button>
    </form> : null}
  </>
}

function MapScreen({ points, center, selectingForPost = false }) {
  const first = points[0]
  return <section className="figma-feed-map-screen">
    {selectingForPost ? <div className="figma-map-selection-notice"><strong>Choose a place for your post.</strong><Link href="/create/post">Cancel</Link></div> : null}
    <div className="figma-feed-map-canvas">{points.length ? <LocationMap initialPoints={points} initialCenter={center} /> : <div className="figma-feed-map-empty">Save a place to see it on your map.</div>}</div>
    {first ? <>
      <div className="figma-feed-map-puddle" aria-hidden="true" />
      <Link className="figma-feed-map-card" href={detailHref(first)}>
        <span>{categoryLabel(first.category)}</span><small>{first.city || first.neighborhood || ''}</small><strong>{first.title}</strong><b>+</b>
      </Link>
    </> : null}
  </section>
}

export default async function LocationMapPage({ searchParams }) {
  const params = await searchParams
  const view = params?.view === 'map' ? 'map' : 'feed'
  const query = typeof params?.q === 'string' ? params.q.trim() : ''
  const selectingForPost = view === 'map' && params?.selectForPost === '1'

  return renderProductPage(async (session) => {
    const mapSnapshot = await getLocationMapSnapshot(session)
    const feed = view === 'feed' ? await getSocialFeedSnapshot(session, query) : null
    const mapPoints = selectingForPost
      ? mapSnapshot.points.map((point) => ({ ...point, href: `/create/post?location=${encodeURIComponent(point.id)}` }))
      : mapSnapshot.points

    return <div className={`figma-feed-screen is-${view}`}>
      <AuthMessage searchParams={params} />
      <FeedTop view={view} query={params?.q} />
      {view === 'map' ? <MapScreen points={mapPoints} center={mapSnapshot.center} selectingForPost={selectingForPost} /> : <>
        <section className="figma-feed-stream" aria-label="Puddle feed">
          {feed.items.length ? feed.items.map((post) => <FeedPost post={post} friends={feed.friends} key={post.id} />) : <div className="figma-feed-empty"><strong>{query ? 'No puddles match that search.' : 'No one has posted a puddle yet.'}</strong><Link href="/create/post">Create the first one</Link></div>}
        </section>
        <Link className="figma-feed-composer" href="/create/post">
          <span className="figma-feed-post-avatar" style={feed.self.avatar_url ? { backgroundImage: `url(${feed.self.avatar_url})` } : undefined}>{feed.self.avatar_url ? null : initials(feed.self.display_name)}</span>
          <span>Create a puddle...</span><b>↑</b>
        </Link>
      </>}
    </div>
  })
}
