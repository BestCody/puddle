import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { LocationMap } from '@/components/location-map'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getLocationMapSnapshot } from '@/lib/app/location-map-data'
import { getSocialFeedSnapshot } from '@/lib/app/social-feed-data'
import { createFeedComment, shareFeedPost, toggleFeedSave } from './actions'
import styles from './MapFeed.module.css'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Feed and map',
  description: 'Browse Puddle posts or search Puddle locations on the map.'
}

function initials(name) {
  return String(name || 'P').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
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
    <Link
      href={href}
      className={`${styles.photo} ${styles.photoMain}`}
      style={photos[0] ? { backgroundImage: `url(${photos[0]})` } : undefined}
      aria-label={`Open ${post.location.name}`}
    />
    <Link
      href={href}
      className={styles.photo}
      style={photos[1] ? { backgroundImage: `url(${photos[1]})` } : undefined}
      aria-label={`Open ${post.location.name} photo 2`}
    />
    <Link
      href={href}
      className={styles.photo}
      style={photos[2] ? { backgroundImage: `url(${photos[2]})` } : undefined}
      aria-label={`Open ${post.location.name} photo 3`}
    >
      {count > 3 ? `+${count - 2}` : null}
    </Link>
  </div>
}

function FeedPost({ post, friends }) {
  const author = post.author || {}
  const location = post.location
  const href = `/plans/${location.slug}`
  const authorName = author.display_name || author.username || 'Puddle person'

  return <article className={styles.post} id={`post-${post.id}`} data-testid="feed-post" aria-label={post.title || `Puddle at ${location.name}`}>
    <header className={styles.author}>
      <span className={styles.avatar} style={post.author_avatar_url ? { backgroundImage: `url(${post.author_avatar_url})` } : undefined}>
        {post.author_avatar_url ? null : initials(authorName)}
      </span>
      <span className={styles.authorMeta}>
        <strong>{authorName}</strong>
        <small>{timeLabel(post.created_at)}</small>
      </span>
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
          </p>)}</div> : <p>No comments yet.</p>}
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

      <details className={styles.actionMenu}>
        <summary aria-label={`Share ${post.title}`}>↗</summary>
        <div className={`${styles.actionPanel} ${styles.sharePanel}`}>
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
  return <header className={styles.header} data-testid="feed-header">
    <Link className={styles.back} href="/discover" aria-label="Back to Swipe">‹</Link>
    <nav className={styles.tabs} aria-label="Feed or map" data-testid="feed-tabs">
      <Link className={`${styles.tab} ${view === 'feed' ? styles.tabActive : ''}`} href="/map">Feed</Link>
      <Link className={`${styles.tab} ${view === 'map' ? styles.tabActive : ''}`} href="/map?view=map">Map</Link>
    </nav>
    {view === 'feed' ? <form className={styles.search} action="/map" method="get" data-testid="feed-search">
      <label><input aria-label="Search puddle" type="search" name="q" defaultValue={query || ''} placeholder="Search puddle" /></label>
      <button type="submit" aria-label="Search">⌕</button>
    </form> : <span aria-hidden="true" />}
  </header>
}

function MapSearch({ query }) {
  return <form className={styles.mapSearch} action="/map" method="get" data-testid="map-search">
    <input type="hidden" name="view" value="map" />
    <label><input aria-label="Search all Puddle locations" type="search" name="q" defaultValue={query || ''} placeholder="Search all Puddle locations" /></label>
    <button type="submit" aria-label="Search map">⌕</button>
  </form>
}

function MapScreen({ points, center, heatmap = [], passActive = false, selectingForPost = false, query = '' }) {
  const first = points[0]
  const hasMapContent = points.length || (!query && passActive && heatmap.length)

  return <section className={styles.mapScreen} data-testid="feed-map-canvas">
    {selectingForPost ? <div className={styles.mapSelectionNotice}>
      <strong>Choose a place for your post.</strong>
      <Link href="/create/post">Cancel</Link>
    </div> : null}

    <div className={styles.mapCanvas}>
      {hasMapContent ? <LocationMap initialPoints={points} initialCenter={center} heatmapPoints={query ? [] : heatmap} passActive={passActive && !selectingForPost && !query} /> : <div className={styles.mapEmpty}>{query ? 'No Puddle locations match that search.' : 'Save a place to see it on your map, or search the full Puddle catalogue.'}</div>}
    </div>

    {first ? <>
      <div className={styles.mapPuddle} aria-hidden="true" />
      <Link className={styles.mapCard} href={detailHref(first)}>
        <span className={styles.mapCardMeta}>{categoryLabel(first.category)}</span>
        <small className={styles.mapCardArea}>{first.city || first.neighborhood || ''}</small>
        <strong>{first.title}</strong>
        <b className={styles.mapCardAdd}>+</b>
      </Link>
    </> : null}

    <MapSearch query={query} />
  </section>
}

export default async function LocationMapPage({ searchParams }) {
  const params = await searchParams
  const view = params?.view === 'map' ? 'map' : 'feed'
  const query = typeof params?.q === 'string' ? params.q.trim() : ''
  const selectingForPost = view === 'map' && params?.selectForPost === '1'

  return renderProductPage(async (session) => {
    const mapSnapshot = await getLocationMapSnapshot(session, view === 'map' ? query : '')
    const feed = view === 'feed' ? await getSocialFeedSnapshot(session, query) : null
    const mapPoints = selectingForPost
      ? mapSnapshot.points.map((point) => ({ ...point, href: `/create/post?location=${encodeURIComponent(point.id)}` }))
      : mapSnapshot.points

    return <>
      <AuthMessage searchParams={params} />
      <div className={`${styles.screen} ${view === 'map' ? styles.mapMode : ''}`} data-testid="feed-screen" data-view={view}>
        <FeedTop view={view} query={params?.q} />

        {view === 'map' ? <MapScreen points={mapPoints} center={mapSnapshot.center} heatmap={mapSnapshot.heatmap} passActive={mapSnapshot.passActive} selectingForPost={selectingForPost} query={query} /> : <>
          <section className={styles.stream} aria-label="Puddle feed" data-testid="feed-stream">
            {feed.items.length ? feed.items.map((post) => <FeedPost post={post} friends={feed.friends} key={post.id} />) : <div className={styles.empty}>
              <strong>{query ? 'No puddles match that search.' : 'No one has posted a puddle yet.'}</strong>
              <Link href="/create/post">Create the first one</Link>
            </div>}
          </section>

          <Link className={styles.composer} href="/create/post" data-testid="feed-composer">
            <span className={styles.avatar} style={feed.self.avatar_url ? { backgroundImage: `url(${feed.self.avatar_url})` } : undefined}>
              {feed.self.avatar_url ? null : initials(feed.self.display_name)}
            </span>
            <span className={styles.composerText}>Create a puddle...</span>
            <b className={styles.composerSubmit}>↑</b>
          </Link>
        </>}
      </div>
    </>
  })
}
