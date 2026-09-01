"use client"

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { DiscoverCreatePuddle } from '@/components/discover-create-puddle'
import { PhotoFrame } from '@/components/photo-frame'
import { LocationVisualPreview } from '@/components/location-visual-preview'
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

function CommentIcon() {
  return <svg className={styles.actionIcon} viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 5.5h11A2.5 2.5 0 0 1 20 8v6a2.5 2.5 0 0 1-2.5 2.5H11L6 20v-3.5h-.5A2.5 2.5 0 0 1 3 14V8a2.5 2.5 0 0 1 2.5-2.5Z" /></svg>
}

function OpenPuddleIcon() {
  return <svg className={styles.actionIcon} viewBox="0 0 24 24" aria-hidden="true"><path d="M13 5h6v6M11 13l8-8M18 14v3.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 17.5v-10A1.5 1.5 0 0 1 6.5 6H10" /></svg>
}

function SaveIcon({ saved }) {
  return <svg className={`${styles.actionIcon} ${saved ? styles.actionIconFilled : ''}`} viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4.5h11A1.5 1.5 0 0 1 19 6v14l-7-3.8L5 20V6a1.5 1.5 0 0 1 1.5-1.5Z" /></svg>
}

function FeedPost({ post }) {
  const author = post.author || {}
  const location = post.location
  const href = `/plans/${location.slug}`
  const authorName = author.display_name || author.username || 'Puddle person'
  const title = String(post.title || location.name || 'Puddle').trim()
  const comments = Array.isArray(post.comments) ? post.comments : []
  const image = Array.isArray(post.photo_urls) ? post.photo_urls.find(Boolean) || null : null
  return <article className={styles.post} id={`post-${post.id}`} data-testid="feed-post" aria-label={title}>
    <header className={styles.author}>
      <PhotoFrame as="span" src={post.author_avatar_url} alt="" className={styles.avatar} unavailableText={initials(authorName)} loadingText="" />
      <span className={styles.authorMeta}><strong>{authorName}</strong><small>{timeLabel(post.created_at)}</small></span>
    </header>
    <h2 className={styles.postTitle}>{title}</h2>
    {post.body ? <p className={styles.copy}>{post.body}</p> : null}
    <Link className={styles.place} href={href} aria-label={`Open ${location.name}`}>
      <span className={styles.placeMeta}>{categoryLabel(location.kind)}</span>
      <small className={styles.placeArea}>{location.neighborhood || location.city || ''}</small>
      <h2>{location.name}</h2><b className={styles.placeAdd} aria-hidden="true">+</b>
      <span className={styles.placeVisual}>
        <LocationVisualPreview slug={location.slug} title={location.name} image={image} />
      </span>
    </Link>
    <footer className={styles.interactions} aria-label="Post actions">
      <details className={styles.actionMenu}>
        <summary className={styles.actionButton} aria-label={`Comment on ${title}`}><CommentIcon /><span className={styles.actionCount}>{comments.length || ''}</span></summary>
        <div className={styles.actionPanel}>
          {comments.length ? <div className={styles.commentList}>{comments.map((comment) => <p key={comment.id}><strong>{comment.author?.display_name || comment.author?.username || 'Puddle person'}</strong><span>{comment.body}</span></p>)}</div> : <p>No recent comments.</p>}
          <form action={createFeedComment}><input type="hidden" name="post_id" value={post.id} /><input name="comment_body" required maxLength="2000" placeholder="Add a comment" aria-label="Add a comment" /><button type="submit">Post</button></form>
        </div>
      </details>
      <Link className={styles.actionButton} href={href} aria-label="Open puddle"><OpenPuddleIcon /></Link>
      <form action={toggleFeedSave}><input type="hidden" name="location_id" value={post.location_id} /><button className={`${styles.actionButton} ${post.saved ? styles.saved : ''}`} type="submit" aria-label={post.saved ? `Remove ${location.name} from Saved` : `Save ${location.name}`}><SaveIcon saved={post.saved} /></button></form>
      <FeedShareMenu postId={post.id} title={title} />
    </footer>
  </article>
}

function nextFeedQuery(query, pagination) {
  if (!pagination?.hasMore || !pagination.nextBeforeCreatedAt || !pagination.nextBeforePostId) return null
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  params.set('before', pagination.nextBeforeCreatedAt)
  params.set('beforeId', pagination.nextBeforePostId)
  return params.toString()
}

function FeedPagination({ query, pagination, loading, error, onLoadMore, sentinelRef }) {
  if (!nextFeedQuery(query, pagination)) return null
  return <nav ref={sentinelRef} className={styles.pagination} aria-label="Load more feed content" data-testid="feed-load-sentinel">
    {loading ? <p role="status" aria-live="polite">Loading more puddles…</p> : null}
    {error ? <><p role="alert">{error}</p><button type="button" onClick={onLoadMore} disabled={loading} aria-busy={loading}>Try again</button></> : null}
  </nav>
}

function FeedStream({ feed, query, loadingMore, loadMoreError, onLoadMore, sentinelRef }) {
  return feed.items.length ? <>
    {feed.items.map((post) => <FeedPost post={post} key={post.id} />)}
    <FeedPagination
      query={query}
      pagination={feed.pagination}
      loading={loadingMore}
      error={loadMoreError}
      onLoadMore={onLoadMore}
      sentinelRef={sentinelRef}
    />
  </> : <div className={styles.empty}>
    <strong>{query ? 'No puddles match that search on this page.' : 'No one has posted a puddle yet.'}</strong>
    {nextFeedQuery(query, feed.pagination)
      ? <FeedPagination
        query={query}
        pagination={feed.pagination}
        loading={loadingMore}
        error={loadMoreError}
        onLoadMore={onLoadMore}
        sentinelRef={sentinelRef}
      />
      : <Link href="/map?compose=1">Create the first one</Link>}
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
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState('')
  const [reload, setReload] = useState(0)
  const [identity, setIdentity] = useState({ avatarUrl, displayName })
  const feedGenerationRef = useRef(0)
  const loadMoreControllerRef = useRef(null)
  const loadMoreQueryRef = useRef(null)
  const loadMoreSentinelRef = useRef(null)
  const loadMoreRef = useRef(null)

  useEffect(() => {
    setIdentity({ avatarUrl, displayName })
  }, [avatarUrl, displayName])

  useEffect(() => {
    const generation = feedGenerationRef.current + 1
    feedGenerationRef.current = generation
    loadMoreControllerRef.current?.abort()
    loadMoreControllerRef.current = null
    loadMoreQueryRef.current = null
    const controller = new AbortController()
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (beforeCreatedAt) params.set('before', beforeCreatedAt)
    if (beforePostId) params.set('beforeId', beforePostId)
    setFeed(null)
    setError('')
    setLoadingMore(false)
    setLoadMoreError('')

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
        if (controller.signal.aborted || generation !== feedGenerationRef.current) return
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

    return () => {
      controller.abort()
      loadMoreControllerRef.current?.abort()
      loadMoreControllerRef.current = null
    }
  }, [avatarUrl, beforeCreatedAt, beforePostId, displayName, query, reload])

  async function loadMore() {
    if (loadingMore || !feed || loadMoreControllerRef.current) return
    const nextQuery = nextFeedQuery(query, feed.pagination)
    if (!nextQuery || nextQuery === loadMoreQueryRef.current) return

    const generation = feedGenerationRef.current
    const controller = new AbortController()
    loadMoreQueryRef.current = nextQuery
    loadMoreControllerRef.current = controller
    setLoadingMore(true)
    setLoadMoreError('')

    try {
      const response = await fetch(`/api/social-feed?${nextQuery}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal
      })
      const payload = await response.json()
      if (!response.ok) {
        if (payload?.code === 'onboarding_required') window.location.assign('/onboarding')
        throw new Error(payload?.error || `Feed returned ${response.status}`)
      }
      if (controller.signal.aborted || generation !== feedGenerationRef.current) return

      setFeed((current) => {
        if (!current || generation !== feedGenerationRef.current) return current
        const mergedItems = []
        const seenIds = new Set()
        for (const item of [...(Array.isArray(current.items) ? current.items : []), ...(Array.isArray(payload.items) ? payload.items : [])]) {
          if (!item?.id || seenIds.has(item.id)) continue
          seenIds.add(item.id)
          mergedItems.push(item)
        }
        return { ...current, ...payload, items: mergedItems }
      })
      if (payload?.self) {
        setIdentity({
          avatarUrl: payload.self.avatar_url || avatarUrl || null,
          displayName: payload.self.display_name || displayName || 'Puddle person'
        })
      }
    } catch (cause) {
      if (!controller.signal.aborted && generation === feedGenerationRef.current) {
        loadMoreQueryRef.current = null
        console.warn('Could not load more social feed posts.', { message: cause?.message || 'unknown error' })
        setLoadMoreError('More puddles could not be loaded.')
      }
    } finally {
      if (loadMoreControllerRef.current === controller) {
        loadMoreControllerRef.current = null
        if (generation === feedGenerationRef.current) setLoadingMore(false)
      }
    }
  }

  loadMoreRef.current = loadMore

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current
    if (!sentinel || !feed || !nextFeedQuery(query, feed.pagination)) return undefined
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreRef.current?.()
    }, { rootMargin: '0% 0% 35% 0%' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [feed, query])

  return <>
    <section className={styles.stream} aria-label="Discover posts" data-testid="feed-stream">
      {error ? <div className={styles.empty} role="alert"><strong>Could not load posts.</strong><button type="button" onClick={() => setReload((value) => value + 1)}>Try again</button><small>Check your connection and try again.</small></div>
        : feed ? <FeedStream feed={feed} query={query} loadingMore={loadingMore} loadMoreError={loadMoreError} onLoadMore={loadMore} sentinelRef={loadMoreSentinelRef} />
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
