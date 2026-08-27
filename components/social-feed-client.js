"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { DiscoverCreatePuddle } from '@/components/discover-create-puddle'
import { PhotoFrame } from '@/components/photo-frame'
import { createFeedComment, toggleFeedSave } from '@/app/(product)/map/actions'
import { FeedShareMenu } from '@/app/(product)/map/feed-share-menu'
import styles from '@/app/(product)/map/MapFeed.module.css'

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

function FeedPhoto({ href, locationName, url, label, className = '', moreCount = 0 }) {
  return <PhotoFrame
    as={Link}
    href={href}
    className={`${styles.photo} ${className}`}
    unavailableClassName={styles.photoUnavailable}
    unavailableText="Photo unavailable"
    alt=""
    aria-label={!url ? `No verified photo available for ${locationName}` : label}
  >
    {moreCount > 0 ? <span className={styles.photoCount}>+{moreCount}</span> : null}
  </PhotoFrame>
}

function FeedPhotos({ post, href }) {
  const photos = Array.isArray(post.photo_urls) ? post.photo_urls.filter(Boolean) : []
  const count = photos.length
  const locationName = post.location.name
  if (!count) return <div className={styles.photos} aria-label={`${locationName} photos`}>
    <FeedPhoto href={href} locationName={locationName} url={null} label={`Open ${locationName}`} className={styles.photoEmpty} />
  </div>
  return <div className={styles.photos} aria-label={`${locationName} photos`}>
    {photos.slice(0, 3).map((url, index) => {
      const layoutClass = count === 1
        ? styles.photoSingle
        : count === 2
          ? (index === 0 ? styles.photoMain : styles.photoPair)
          : index === 0 ? styles.photoMain : ''
      return <FeedPhoto
        key={`${url}:${index}`}
        href={href}
        locationName={locationName}
        url={url}
        label={`Open ${locationName}${index ? ` photo ${index + 1}` : ''}`}
        className={layoutClass}
        moreCount={index === 2 ? count - 3 : 0}
      />
    })}
  </div>
}

function CommentIcon() {
  return <svg className={styles.actionIcon} viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5h15v10h-9l-4.5 3v-3H4.5v-10Z" /></svg>
}

function OpenPuddleIcon() {
  return <svg className={styles.actionIcon} viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M9 6h9v9" /></svg>
}

function SaveIcon({ saved }) {
  return <svg className={`${styles.actionIcon} ${saved ? styles.actionIconFilled : ''}`} viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.6c0 5-8.8 10.4-8.8 10.4S3.2 13.6 3.2 8.6A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8.8 1.9Z" /></svg>
}

function FeedPost({ post }) {
  const author = post.author || {}
  const location = post.location
  const href = `/plans/${location.slug}`
  const authorName = author.display_name || author.username || 'Puddle person'
  const comments = Array.isArray(post.comments) ? post.comments : []
  return <article className={styles.post} id={`post-${post.id}`} data-testid="feed-post" aria-label={post.title || `Puddle at ${location.name}`}>
    <header className={styles.author}>
      <PhotoFrame as="span" src={post.author_avatar_url} alt="" className={styles.avatar} unavailableText={initials(authorName)} loadingText="" />
      <span className={styles.authorMeta}><strong>{authorName}</strong><small>{timeLabel(post.created_at)}</small></span>
    </header>
    {post.body ? <p className={styles.copy}>{post.body}</p> : null}
    <FeedPhotos post={post} href={href} />
    <Link className={styles.place} href={href}>
      <span className={styles.placeMeta}>{categoryLabel(location.kind)}</span>
      <small className={styles.placeArea}>{location.neighborhood || location.city || ''}</small>
      <h2>{location.name}</h2><b className={styles.placeAdd} aria-hidden="true">+</b>
    </Link>
    <footer className={styles.interactions} aria-label="Post actions">
      <details className={styles.actionMenu}>
        <summary aria-label={`Comment on ${post.title}`}><CommentIcon /><span className={styles.actionCount}>{comments.length || ''}</span></summary>
        <div className={styles.actionPanel}>
          {comments.length ? <div className={styles.commentList}>{comments.map((comment) => <p key={comment.id}><strong>{comment.author?.display_name || comment.author?.username || 'Puddle person'}</strong><span>{comment.body}</span></p>)}</div> : <p>No recent comments.</p>}
          <form action={createFeedComment}><input type="hidden" name="post_id" value={post.id} /><input name="comment_body" required maxLength="2000" placeholder="Add a comment" aria-label="Add a comment" /><button type="submit">Post</button></form>
        </div>
      </details>
      <Link href={href} aria-label="Open puddle"><OpenPuddleIcon /></Link>
      <form action={toggleFeedSave}><input type="hidden" name="location_id" value={post.location_id} /><button className={post.saved ? styles.saved : ''} type="submit" aria-label={post.saved ? `Remove ${location.name} from Saved` : `Save ${location.name}`}><SaveIcon saved={post.saved} /></button></form>
      <FeedShareMenu postId={post.id} title={post.title || location.name} />
    </footer>
  </article>
}

function nextFeedHref(query, pagination) {
  if (!pagination?.hasMore || !pagination.nextBeforeCreatedAt || !pagination.nextBeforePostId) return null
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  params.set('before', pagination.nextBeforeCreatedAt)
  params.set('beforeId', pagination.nextBeforePostId)
  return `/map?${params.toString()}`
}

function FeedStream({ feed, query }) {
  const moreHref = nextFeedHref(query, feed.pagination)
  return feed.items.length ? <>
    {feed.items.map((post) => <FeedPost post={post} key={post.id} />)}
    {moreHref ? <nav aria-label="Discover pagination"><Link href={moreHref}>More puddles</Link></nav> : null}
  </> : <div className={styles.empty}>
    <strong>{query ? 'No puddles match that search on this page.' : 'No one has posted a puddle yet.'}</strong>
    {moreHref ? <Link href={moreHref}>Search older puddles</Link> : <Link href="/map?compose=1">Create the first one</Link>}
  </div>
}

export function SocialFeedClient({
  query = '',
  beforeCreatedAt = null,
  beforePostId = null,
  avatarUrl = null,
  displayName = 'Puddle person',
  initialOpen = false,
  requestedLocation = ''
}) {
  const [feed, setFeed] = useState(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [identity, setIdentity] = useState({ avatarUrl, displayName })

  useEffect(() => {
    setIdentity({ avatarUrl, displayName })
  }, [avatarUrl, displayName])

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (beforeCreatedAt) params.set('before', beforeCreatedAt)
    if (beforePostId) params.set('beforeId', beforePostId)
    setFeed(null)
    setError('')

    fetch(`/api/social-feed${params.toString() ? `?${params}` : ''}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) {
          if (payload?.code === 'onboarding_required') window.location.assign('/onboarding')
          throw new Error(payload?.error || `Feed returned ${response.status}`)
        }
        return payload
      })
      .then((payload) => {
        if (controller.signal.aborted) return
        setFeed(payload)
        if (payload?.self) {
          setIdentity({
            avatarUrl: payload.self.avatar_url || avatarUrl || null,
            displayName: payload.self.display_name || displayName || 'Puddle person'
          })
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          console.warn('Could not load social feed.', { message: cause?.message || 'unknown error' })
          setError('The feed could not be loaded.')
        }
      })

    return () => controller.abort()
  }, [beforeCreatedAt, beforePostId, query, reload])

  return <>
    <section className={styles.stream} aria-label="Discover posts" data-testid="feed-stream">
      {error ? <div className={styles.empty} role="alert"><strong>Could not load posts.</strong><button type="button" onClick={() => setReload((value) => value + 1)}>Try again</button><small>Check your connection and try again.</small></div>
        : feed ? <FeedStream feed={feed} query={query} />
          : <div className={styles.empty} role="status" aria-label="Loading posts"><strong>Loading…</strong></div>}
    </section>
    <DiscoverCreatePuddle
      avatarUrl={identity.avatarUrl}
      displayName={identity.displayName}
      initialOpen={initialOpen}
      requestedLocation={requestedLocation}
    />
  </>
}
