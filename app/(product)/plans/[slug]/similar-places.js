"use client"

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PhotoFrame } from '@/components/photo-frame'
import styles from '../Plans.module.css'

function categoryLabel(value) {
  return String(value || 'Place').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function itemHref(item) {
  return item.content_kind === 'event' ? `/events/${item.slug}` : `/plans/${item.slug}`
}

function itemTitle(item) {
  return item.title || item.name || 'Puddle'
}

function itemLocation(item) {
  return item.city || item.location?.city || categoryLabel(item.category || item.kind)
}

export function SimilarPlaces({ slug }) {
  const [state, setState] = useState({ loading: true, items: [], error: null })
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState({ loading: true, items: [], error: null })
    async function load() {
      try {
        const response = await fetch(`/api/public-location/${encodeURIComponent(slug)}/similar`, {
          signal: controller.signal
        })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.error || 'Recommendations could not be loaded.')
        setState({ loading: false, items: Array.isArray(payload?.items) ? payload.items : [], error: null })
      } catch (error) {
        if (error?.name !== 'AbortError') setState({ loading: false, items: [], error: 'Recommendations could not be loaded.' })
      }
    }
    load()
    return () => controller.abort()
  }, [slug, retry])

  return <section className={styles.similar} data-testid="saved-similar" aria-busy={state.loading || undefined}>
    <h2>Similar splashes</h2>
    {state.loading ? <div className={styles.similarStatus} role="status">Loading similar places…</div> : null}
    {state.error ? <div className={`${styles.similarStatus} ${styles.similarStatusError}`} role="alert"><span>{state.error}</span><button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div> : null}
    {!state.loading && !state.error ? <div className={styles.similarGrid}>{state.items.slice(0, 3).map((item) => <Link className={styles.similarCard} href={itemHref(item)} key={`${item.content_kind || 'place'}:${item.id}`}>
      <PhotoFrame as="span" src={item.cover_url} alt={`${itemTitle(item)} photo`} className={styles.similarPhoto} unavailableClassName={styles.similarPhotoUnavailable} />
      <strong>{itemTitle(item)}</strong>
      <small><span>{itemLocation(item)}</span>{Number.isFinite(Number(item.distance_km)) ? <b>{Number(item.distance_km).toFixed(1)} km</b> : null}</small>
    </Link>)}</div> : null}
  </section>
}
