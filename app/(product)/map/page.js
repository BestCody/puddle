import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { InstantSegment } from '@/components/instant-segment'
import { LocationMap } from '@/components/location-map'
import { DiscoverCreatePuddle } from '@/components/discover-create-puddle'
import { DiscoverSearchOverlay } from '@/components/discover-search-overlay'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getLocationMapSnapshot } from '@/lib/app/location-map-data'
import { getSocialFeedSnapshot } from '@/lib/app/social-feed-data'
import { FeedShareMenu } from './feed-share-menu'
import { createFeedComment, toggleFeedSave } from './actions'
import styles from './MapFeed.module.css'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Discover and map',
  description: 'Browse Puddle posts and explore Puddle locations on the map.'
}

function initials(name) {
  return String(name || 'P').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}

function categoryLabel(value) {
  return String(value || 'Place').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function timeLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

function FeedPhotos({ post, href }) {
  const photos = post.photo_urls || []
  const count = photos.length

  return <div className={styles.photos} aria-label={`${post.location.name} photos`}>
    <Link href={href} className={`${styles.photo} ${styles.photoMain}`} style={photos[0] ? { backgroundImage: `url(${photos[0]})` } : undefined} aria-label={`Open ${post.location.name}`} />
    <Link href={href} className={styles.photo} style={photos[1] ? { backgroundImage: `url(${photos[1]})` } : undefined} aria-label={`Open ${post.location.name} photo 2`} />
    <Link href={href} className={styles.photo} style={photos[2] ? { backgroundImage: `url(${photos[2]})` } : undefined} aria-label={`Open ${post.location.name} photo 3`}>
      {count > 3 ? `+${count - 2}` : null}
    </Link>
  </div>
}

function FeedPost({ post }) {
  const author = post.author || {}
  const location = post.location
  const href = `/plans/${location.slug}`
  const authorName = author.display_name || author.username || 'Puddle person'

  return <article className={styles.post} id={`post-${post.id}`} data-testid="feed-post" aria-label={post.title || `Puddle at ${location.name}`}>
    <header className={styles.author}>
      <span className={styles.avatar} style={post.author_avatar_url ? { backgroundImage: `url(${post.author_avatar_url})` } : undefined}>
        {post.author_avatar_url ? null : initials(authorName)}
      </span>
      <span className={styles.authorMeta}><strong>{authorName}</strong><small>{timeLabel(post.created_at)}</small></span>
    </header>

    {post.body ? <p className={styles.copy}>{post.body}</p> : null}
    <FeedPhotos post={post} href={href} />

    <Link className={styles.place} href={href}>
      <span className={styles.placeMeta}>{categoryLabel(location.kind)}</span>
      <small className={styles.placeArea}>{location.neighborhood || location.city || ''}</small>
      <h2>{location.name}</h2>
      <b className={styles.placeAdd} aria-hidden="true">+</b>
    </Link>

    <footer className={styles.interactions} aria-label="Post actions">
      <details className={styles.actionMenu}>
        <summary aria-label={`Comment on ${post.title}`}>◯<span>{post.comments.length || ''}</span></summary>
        <div className={styles.actionPanel}>
          {post.comments.length ? <div className={styles.commentList}>{post.comments.map((comment) => <p key={comment.id}>
            <strong>{comment.author?.display_name || comment.author?.username || 'Puddle person'}</strong>
            <span>{comment.body}</span>
          </p>)}</div> : <p>No recent comments.</p>}
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
        <button className={post.saved ? styles.saved : ''} type="submit" aria-label={post.saved ? `Remove ${location.name} from Saved` : `Save ${location.name}`}>
          {post.saved ? '♥' : '♡'}
        </button>
      </form>

      <FeedShareMenu postId={post.id} title={post.title || location.name} />
    </footer>
  </article>
}

function FeedTop({ view, query }) {
  return <header className={styles.header} data-testid="feed-header">
    <Link className={styles.back} href="/discover" aria-label="Back to Swipe">‹</Link>
    <InstantSegment
      className={styles.tabs}
      tone="yellow"
      activeValue={view}
      ariaLabel="Posts or map"
      testId="feed-tabs"
      items={[
        { value: 'feed', label: 'Posts', href: '/map' },
        { value: 'map', label: 'Map', href: '/map?view=map' }
      ]}
    />
    {view === 'feed' ? <DiscoverSearchOverlay initialQuery={query || ''} /> : <span aria-hidden="true" />}
  </header>
}

function MapScreen({ points, center, heatmap = [], passActive = false, selectingForPost = false }) {
  return <section className={styles.mapScreen} data-testid="feed-map-canvas">
    {selectingForPost ? <div className={styles.mapSelectionNotice}><strong>Choose a place for your post.</strong><Link href="/create/post">Cancel</Link></div> : null}
    <div className={styles.mapCanvas}>
      <LocationMap initialPoints={points} initialCenter={center} heatmapPoints={heatmap} passActive={passActive && !selectingForPost} loadCatalogue selectingForPost={selectingForPost} />
    </div>
  </section>
}

function nextFeedHref(query, pagination) {
  if (!pagination?.hasMore || !pagination.nextBeforeCreatedAt || !pagination.nextBeforePostId) return null
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  params.set('before', pagination.nextBeforeCreatedAt)
  params.set('beforeId', pagination.nextBeforePostId)
  return `/map?${params.toString()}`
}

export default async function LocationMapPage({ searchParams }) {
  const params = await searchParams
  const view = params?.view === 'map' ? 'map' : 'feed'
  const query = typeof params?.q === 'string' ? params.q.trim() : ''
  const selectingForPost = view === 'map' && params?.selectForPost === '1'
  const beforeCreatedAt = typeof params?.before === 'string' ? params.before : null
  const beforePostId = typeof params?.beforeId === 'string' ? params.beforeId : null

  return renderProductPage(async (session) => {
    const [mapSnapshot, feed] = await Promise.all([
      view === 'map' ? getLocationMapSnapshot(session) : Promise.resolve(null),
      view === 'feed'
        ? getSocialFeedSnapshot(session, query, { beforeCreatedAt, beforePostId })
        : Promise.resolve(null)
    ])
    const mapPoints = selectingForPost && mapSnapshot
      ? mapSnapshot.points.map((point) => ({ ...point, href: `/create/post?location=${encodeURIComponent(point.id)}` }))
      : mapSnapshot?.points || []
    const moreHref = feed ? nextFeedHref(query, feed.pagination) : null

    return <>
      <AuthMessage searchParams={params} />
      <div className={`${styles.screen} ${view === 'map' ? styles.mapMode : ''}`} data-testid="feed-screen" data-view={view}>
        <FeedTop view={view} query={params?.q} />

        {view === 'map' ? <MapScreen points={mapPoints} center={mapSnapshot.center} heatmap={mapSnapshot.heatmap} passActive={mapSnapshot.passActive} selectingForPost={selectingForPost} /> : <>
          <section className={styles.stream} aria-label="Discover posts" data-testid="feed-stream">
            {feed.items.length ? feed.items.map((post) => <FeedPost post={post} key={post.id} />) : <div className={styles.empty}>
              <strong>{query ? 'No puddles match that search on this page.' : 'No one has posted a puddle yet.'}</strong>
              {moreHref ? <Link href={moreHref}>Search older puddles</Link> : <Link href="/create/post">Create the first one</Link>}
            </div>}
            {moreHref && feed.items.length ? <nav aria-label="Discover pagination"><Link href={moreHref}>More puddles</Link></nav> : null}
          </section>

          <DiscoverCreatePuddle
            avatarUrl={feed.self.avatar_url}
            displayName={feed.self.display_name || 'Puddle person'}
          />
        </>}
      </div>
    </>
  })
}
