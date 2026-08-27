"use client"

import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useRouter } from 'next/navigation'
import { LocationMap } from '@/components/location-map'
import { useModalFocus } from '@/components/modal-focus'
import { PhotoFrame } from '@/components/photo-frame'
import { savedLocationTransitionNames } from '@/lib/app/saved-location-transition'

function applyNames(card) {
  const key = card?.dataset?.savedMorphKey
  if (!card || !key) return null
  const names = savedLocationTransitionNames(key)
  card.style.viewTransitionName = names.card
  const photo = card.querySelector('[data-saved-morph-photo]')
  const title = card.querySelector('[data-saved-morph-title]')
  const meta = card.querySelector('[data-saved-morph-meta]')
  if (photo) photo.style.viewTransitionName = names.photo
  if (title) title.style.viewTransitionName = names.title
  if (meta) meta.style.viewTransitionName = names.meta
  return names
}

function clearNames(card) {
  if (!card) return
  card.style.viewTransitionName = ''
  for (const node of card.querySelectorAll('[data-saved-morph-photo],[data-saved-morph-title],[data-saved-morph-meta]')) {
    node.style.viewTransitionName = ''
  }
}

function csrfToken() {
  const pairs = document.cookie.split(';').map((value) => value.trim())
  for (const name of ['__Host-puddle-csrf', 'puddle-csrf']) {
    const match = pairs.find((value) => value.startsWith(`${name}=`))
    if (match) return decodeURIComponent(match.slice(name.length + 1))
  }
  return ''
}

function placeLabel(location) {
  return location?.address_public || location?.city || location?.neighborhood || String(location?.kind || 'Saved place').replaceAll('_', ' ')
}

function timeLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

function initials(name) {
  return String(name || 'P').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}

function mapPoint(location, state) {
  const latitude = Number(location?.latitude)
  const longitude = Number(location?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return []
  return [{
    id: location.id,
    location_id: location.id,
    title: location.name,
    summary: location.summary || location.description || '',
    category: location.kind,
    neighborhood: location.neighborhood,
    city: location.city,
    latitude,
    longitude,
    href: '#',
    photo_url: location.cover_url || location.gallery?.[0]?.url || null,
    states: [state?.saved ? 'saved' : 'catalogue'],
    match: null,
    plan: state?.planned ? { planned_for: state.planned.planned_for } : null
  }]
}

function SamePageSavedDetail({ preview, detail, busy, message, detailError, names, onClose, onRetry, onAction }) {
  const detailRef = useRef(null)
  const location = detail?.location || {
    id: preview.key,
    slug: preview.slug,
    name: preview.title,
    city: preview.meta,
    address_public: preview.meta,
    cover_url: preview.image || null,
    gallery: []
  }
  const image = location.cover_url || location.gallery?.[0]?.url || preview.image || null
  const point = mapPoint(location, detail?.state)
  const center = point.length ? { latitude: point[0].latitude, longitude: point[0].longitude } : null
  const posts = detail?.posts || []
  const similarPlaces = (detail?.similar || []).filter((item) => item?.content_kind !== 'event' && item?.slug)

  useModalFocus(detailRef)

  return <div ref={detailRef} className="saved-inline-detail-layer" role="dialog" aria-modal="true" aria-label={`${location.name} details`} tabIndex={-1}>
    <button className="saved-inline-detail-backdrop" type="button" aria-label="Close saved details" onClick={onClose} />
    <article className="saved-inline-detail-card" style={{ viewTransitionName: names.card }}>
      <button className="saved-inline-detail-close" type="button" onClick={onClose} aria-label="Close saved details">×</button>

      <div className="saved-inline-detail-main">
        <PhotoFrame className="saved-inline-detail-hero" data-inline-morph-photo src={image} alt={`${location.name} photo`} loading="eager" style={{ viewTransitionName: names.photo }} />

        <div className="saved-inline-detail-actions">
          <button type="button" disabled={!detail || busy} className="is-primary" onClick={() => onAction('toggle_pinned')}>{detail?.state?.pinned ? 'Unpin' : 'Pin'}</button>
          <button type="button" disabled={!detail || busy} onClick={() => onAction('toggle_saved')}>{detail?.state?.saved === false ? 'Save' : 'Unsave'}</button>
          <details>
            <summary>Share</summary>
            <div>{detail?.friends?.length ? detail.friends.map((friend) => <button type="button" disabled={busy} onClick={() => onAction('share', { friend_id: friend.id })} key={friend.id}>{friend.display_name || friend.username || 'Friend'}</button>) : <small>No friends to share with yet.</small>}</div>
          </details>
        </div>

        <h1 style={{ viewTransitionName: names.title }}>{location.name}</h1>
        <div className="saved-inline-detail-meta" style={{ viewTransitionName: names.meta }}>
          <span>{placeLabel(location)}</span>
          {location.price_level ? <span>{'$'.repeat(Math.max(1, Math.min(4, Number(location.price_level))))}</span> : <span>Price varies</span>}
          <span>Local spot</span>
        </div>

        {detailError ? <div className="saved-inline-detail-message is-error" role="alert"><span>{detailError}</span><button type="button" onClick={onRetry}>Try again</button></div> : null}
        {message ? <div className="saved-inline-detail-message" role="status">{message}</div> : null}

        <section className="saved-inline-detail-plan">
          <h2>Plan a visit</h2>
          <form onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            onAction('plan', { planned_for: form.get('planned_for'), note: form.get('note') })
          }}>
            <input type="datetime-local" name="planned_for" required />
            <input name="note" maxLength="500" placeholder="Optional note" />
            <button type="submit" disabled={!detail || busy}>Add to Plans</button>
          </form>
        </section>

        <section className="saved-inline-detail-posts">
          <div className="saved-inline-detail-posts-heading">
            <h2>Posts</h2>
            <a href={`/create/post?location=${encodeURIComponent(location.id)}`}>Create post</a>
          </div>
          {detail ? posts.length ? <div className="saved-inline-detail-post-list">{posts.map((post) => {
            const authorName = post.author?.display_name || post.author?.username || 'Puddle person'
            return <a className="saved-inline-detail-post" href={`/map#post-${post.id}`} key={post.id}>
              <PhotoFrame as="span" className="saved-inline-detail-post-avatar" src={post.author_avatar_url} alt="" unavailableText={initials(authorName)} loadingText="" />
              <span className="saved-inline-detail-post-copy">
                <span><strong>{authorName}</strong><small>{timeLabel(post.created_at)}</small></span>
                {post.title ? <b>{post.title}</b> : null}
                {post.body ? <p>{post.body}</p> : null}
              </span>
            </a>
          })}</div> : <div className="saved-inline-detail-post-empty"><strong>No posts here yet.</strong><span>Be the first person to post about this place.</span></div> : <div className="saved-inline-detail-post-loading" aria-label="Loading posts" />}
        </section>
      </div>

      <aside className="saved-inline-detail-side">
        <div className="saved-inline-detail-map">{detail && point.length ? <LocationMap initialPoints={point} initialCenter={center} /> : detail ? <div className="saved-inline-detail-map-empty">Map unavailable</div> : <div className="saved-inline-detail-map-loading" />}</div>
        {location.summary || location.description ? <p className="saved-inline-detail-summary">{location.summary || location.description}</p> : null}
        {similarPlaces.length ? <div className="saved-inline-detail-similar"><h2>Similar splashes</h2>{similarPlaces.map((item) => { const title = item.title || item.name || 'Puddle'; return <a href={`/places/${encodeURIComponent(item.slug)}`} key={`place:${item.id || item.slug}`}><PhotoFrame as="span" src={item.cover_url} alt={`${title} photo`} className="saved-inline-detail-similar-photo" /><strong>{title}</strong></a> })}</div> : null}
      </aside>
    </article>
  </div>
}

export function SavedLocationMorphBridge({ detailLocationId = null }) {
  const router = useRouter()
  const [preview, setPreview] = useState(null)
  const [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [detailError, setDetailError] = useState('')
  const sourceCardRef = useRef(null)
  const requestRef = useRef(0)
  const detailLoaderRef = useRef(null)
  const needsRefreshRef = useRef(false)
  const transitionReadyRef = useRef(false)
  const pendingDetailRef = useRef(null)

  useEffect(() => {
    if (detailLocationId) return undefined

    async function loadDetail(nextPreview, requestId) {
      try {
        const response = await fetch(`/api/saved-location/${encodeURIComponent(nextPreview.slug)}`, { cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.error || 'Could not load Saved details.')
        if (requestRef.current !== requestId) return
        if (transitionReadyRef.current) setDetail(payload)
        else pendingDetailRef.current = payload

        const similarResponse = await fetch(`/api/public-location/${encodeURIComponent(nextPreview.slug)}/similar`)
        const similarPayload = await similarResponse.json()
        if (!similarResponse.ok) throw new Error(similarPayload?.error || 'Could not load similar places.')
        if (requestRef.current !== requestId) return
        const similar = Array.isArray(similarPayload?.items) ? similarPayload.items.slice(0, 3) : []
        if (transitionReadyRef.current) setDetail((current) => current ? { ...current, similar } : current)
        else if (pendingDetailRef.current) pendingDetailRef.current = { ...pendingDetailRef.current, similar }
      } catch {
        if (requestRef.current === requestId) setDetailError('Saved details could not be loaded.')
      }
    }

    detailLoaderRef.current = loadDetail

    async function openFromLink(link) {
      const card = link.closest('[data-saved-morph-card]')
      if (!card || !card.dataset.savedMorphSlug) return
      const nextPreview = {
        key: card.dataset.savedMorphKey,
        slug: card.dataset.savedMorphSlug,
        title: card.dataset.savedMorphTitle || 'Saved place',
        meta: card.dataset.savedMorphMetaText || '',
        image: card.dataset.savedMorphImage || ''
      }
      const names = applyNames(card)
      if (!names) return
      sourceCardRef.current = card
      needsRefreshRef.current = false
      transitionReadyRef.current = false
      pendingDetailRef.current = null
      setMessage('')
      setDetailError('')
      setDetail(null)
      requestRef.current += 1
      const requestId = requestRef.current

      const commitOpen = () => {
        clearNames(card)
        flushSync(() => setPreview({ ...nextPreview, names }))
      }
      const transition = document.startViewTransition ? document.startViewTransition(commitOpen) : null
      if (!transition) {
        commitOpen()
        transitionReadyRef.current = true
      }
      loadDetail(nextPreview, requestId)
      if (transition) {
        try { await transition.finished } catch {}
        if (requestRef.current !== requestId) return
        transitionReadyRef.current = true
        if (pendingDetailRef.current) {
          const payload = pendingDetailRef.current
          pendingDetailRef.current = null
          setDetail(payload)
        }
      } else if (pendingDetailRef.current) {
        const payload = pendingDetailRef.current
        pendingDetailRef.current = null
        setDetail(payload)
      }
    }

    function onClick(event) {
      const link = event.target.closest('[data-saved-morph-link]')
      if (!link) return
      event.preventDefault()
      openFromLink(link)
    }

    document.addEventListener('click', onClick, true)
    return () => {
      if (detailLoaderRef.current === loadDetail) detailLoaderRef.current = null
      document.removeEventListener('click', onClick, true)
    }
  }, [detailLocationId])

  async function close() {
    if (!preview) return
    requestRef.current += 1
    transitionReadyRef.current = false
    pendingDetailRef.current = null
    const card = sourceCardRef.current
    const commitClose = () => {
      flushSync(() => {
        setPreview(null)
        setDetail(null)
        setMessage('')
        setDetailError('')
      })
      applyNames(card)
    }
    const transition = document.startViewTransition ? document.startViewTransition(commitClose) : null
    if (transition) {
      try { await transition.finished } catch {}
      clearNames(card)
    } else {
      commitClose()
      clearNames(card)
    }
    if (needsRefreshRef.current) {
      needsRefreshRef.current = false
      router.refresh()
    }
  }

  function retryDetail() {
    if (!preview || busy || !detailLoaderRef.current) return
    requestRef.current += 1
    pendingDetailRef.current = null
    setDetail(null)
    setMessage('')
    setDetailError('')
    detailLoaderRef.current(preview, requestRef.current)
  }

  async function performAction(action, extra = {}) {
    if (!preview || busy) return
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/saved-location/${encodeURIComponent(preview.slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-puddle-csrf': csrfToken() },
        body: JSON.stringify({ action, ...extra })
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || 'That action could not be completed.')
      setDetail(payload)
      setMessage(action === 'toggle_pinned' ? (payload.state?.pinned ? 'Pinned.' : 'Unpinned.') : action === 'toggle_saved' ? (payload.state?.saved ? 'Saved.' : 'Removed from Saved.') : action === 'plan' ? 'Added to Plans.' : action === 'share' ? 'Shared.' : 'Saved.')
      if (['toggle_saved', 'toggle_pinned', 'plan'].includes(action)) needsRefreshRef.current = true
    } catch {
      setMessage('That action could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  if (detailLocationId || !preview) return null
  return <SamePageSavedDetail preview={preview} detail={detail} busy={busy} message={message} detailError={detailError} names={preview.names} onClose={close} onRetry={retryDetail} onAction={performAction} />
}
