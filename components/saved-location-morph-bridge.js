"use client"

import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useRouter } from 'next/navigation'
import { LocationMap } from '@/components/location-map'
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

function SamePageSavedDetail({ preview, detail, busy, message, names, onClose, onAction }) {
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
  const reviews = detail?.reviews || []
  const myReview = detail?.myReview || null

  return <div className="saved-inline-detail-layer" role="dialog" aria-modal="true" aria-label={`${location.name} details`}>
    <button className="saved-inline-detail-backdrop" type="button" aria-label="Close saved details" onClick={onClose} />
    <article className="saved-inline-detail-card" style={{ viewTransitionName: names.card }}>
      <button className="saved-inline-detail-close" type="button" onClick={onClose} aria-label="Close saved details">×</button>

      <div className="saved-inline-detail-main">
        <div className="saved-inline-detail-hero" data-inline-morph-photo style={{ backgroundImage: image ? `url(${image})` : undefined, viewTransitionName: names.photo }} />

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

        <section className="saved-inline-detail-reviews">
          <h2>Reviews{detail?.averageRating ? ` · ${Number(detail.averageRating).toFixed(1)} / 5 (${reviews.length})` : ''}</h2>
          <form onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            onAction('upsert_review', { rating: Number(form.get('rating')), body: form.get('body') })
          }}>
            <select name="rating" defaultValue={String(myReview?.rating || 5)} aria-label="Your rating">
              <option value="5">5 — Excellent</option><option value="4">4 — Great</option><option value="3">3 — Good</option><option value="2">2 — Fair</option><option value="1">1 — Poor</option>
            </select>
            <textarea name="body" maxLength="2000" defaultValue={myReview?.body || ''} placeholder="Share what you thought..." />
            <div><button type="submit" disabled={!detail || busy}>{myReview ? 'Update review' : 'Post review'}</button>{myReview ? <button type="button" disabled={busy} onClick={() => onAction('delete_review')}>Delete</button> : null}</div>
          </form>
          <div className="saved-inline-detail-review-list">{reviews.map((review) => <article key={review.id}><strong>{review.display_name || review.username || 'Puddle person'}</strong><span>{'★'.repeat(Number(review.rating || 0))}</span>{review.body ? <p>{review.body}</p> : null}</article>)}</div>
        </section>
      </div>

      <aside className="saved-inline-detail-side">
        <div className="saved-inline-detail-map">{point.length ? <LocationMap initialPoints={point} initialCenter={center} /> : <div>Map unavailable</div>}</div>
        {location.summary || location.description ? <p className="saved-inline-detail-summary">{location.summary || location.description}</p> : null}
        {detail?.similar?.length ? <div className="saved-inline-detail-similar"><h2>Similar splashes</h2>{detail.similar.map((item) => <a href={item.content_kind === 'event' ? `/events/${item.slug}` : `/plans/${item.slug}`} key={`${item.content_kind || 'place'}:${item.id}`}><span style={item.cover_url ? { backgroundImage: `url(${item.cover_url})` } : undefined} /><strong>{item.title || item.name || 'Puddle'}</strong></a>)}</div> : null}
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
  const sourceCardRef = useRef(null)
  const requestRef = useRef(0)
  const needsRefreshRef = useRef(false)

  useEffect(() => {
    if (detailLocationId) return undefined

    async function loadDetail(nextPreview, requestId) {
      try {
        const response = await fetch(`/api/saved-location/${encodeURIComponent(nextPreview.slug)}`, { cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.error || 'Could not load Saved details.')
        if (requestRef.current === requestId) setDetail(payload)
      } catch (error) {
        if (requestRef.current === requestId) setMessage(error?.message || 'Could not load Saved details.')
      }
    }

    function openFromLink(link) {
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
      setMessage('')
      setDetail(null)
      requestRef.current += 1
      const requestId = requestRef.current

      const commitOpen = () => {
        clearNames(card)
        flushSync(() => setPreview({ ...nextPreview, names }))
      }
      const transition = document.startViewTransition ? document.startViewTransition(commitOpen) : null
      if (!transition) commitOpen()
      loadDetail(nextPreview, requestId)
    }

    function onClick(event) {
      const link = event.target.closest('[data-saved-morph-link]')
      if (!link) return
      event.preventDefault()
      openFromLink(link)
    }

    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [detailLocationId])

  async function close() {
    if (!preview) return
    requestRef.current += 1
    const card = sourceCardRef.current
    const commitClose = () => {
      flushSync(() => {
        setPreview(null)
        setDetail(null)
        setMessage('')
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
      setMessage(action === 'toggle_pinned' ? (payload.state?.pinned ? 'Pinned.' : 'Unpinned.') : action === 'toggle_saved' ? (payload.state?.saved ? 'Saved.' : 'Removed from Saved.') : action === 'plan' ? 'Added to Plans.' : action === 'share' ? 'Shared.' : action === 'delete_review' ? 'Review deleted.' : 'Saved.')
      if (['toggle_saved', 'toggle_pinned', 'plan'].includes(action)) needsRefreshRef.current = true
    } catch (error) {
      setMessage(error?.message || 'That action could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  if (detailLocationId || !preview) return null
  return <SamePageSavedDetail preview={preview} detail={detail} busy={busy} message={message} names={preview.names} onClose={close} onAction={performAction} />
}
