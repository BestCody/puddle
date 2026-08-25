"use client"

import { useEffect, useMemo, useState } from 'react'

function categoryLabel(value) {
  return String(value || 'Saved place').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function SavedLightweightGrid({ items = [], className = '', cardClassName = '', photoClassName = '', copyClassName = '', metaClassName = '', perfectPickClassName = '' }) {
  const ids = useMemo(() => items.map((item) => String(item.location_id || '')).filter(Boolean), [items])
  const [previews, setPreviews] = useState({})

  useEffect(() => {
    if (!ids.length) return undefined
    const controller = new AbortController()
    fetch(`/api/saved-location-options?ids=${encodeURIComponent(ids.join(','))}`, { cache: 'no-store', signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        const next = {}
        for (const item of payload?.items || []) next[String(item.id)] = item
        setPreviews(next)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [ids])

  return <section className={className} aria-label="Saved places" data-testid="saved-grid">
    {items.map((item) => {
      const preview = previews[String(item.location_id)]
      const title = preview?.title || 'Saved place'
      const meta = preview?.city || categoryLabel(preview?.category)
      const slug = preview?.slug || null
      const detail = slug ? `/plans/${slug}` : '#'
      const ready = Boolean(slug)
      return <article
        className={cardClassName}
        data-testid="saved-card"
        data-saved-morph-card={ready ? '' : undefined}
        data-saved-morph-key={ready ? item.location_id : undefined}
        data-saved-morph-slug={ready ? slug : undefined}
        data-saved-morph-title={ready ? title : undefined}
        data-saved-morph-meta-text={ready ? meta : undefined}
        key={`saved:${item.location_id}`}
      >
        <a className={photoClassName} href={detail} data-saved-morph-link={ready ? '' : undefined} aria-disabled={!ready} onClick={(event) => { if (!ready) event.preventDefault() }} aria-label={`Open ${title}`}>
          <span aria-hidden="true">Puddle</span>
          {item.perfect_pick ? <b className={perfectPickClassName}>★ Perfect Pick</b> : null}
        </a>
        <div className={copyClassName}>
          <h2><a href={detail} data-saved-morph-link={ready ? '' : undefined} onClick={(event) => { if (!ready) event.preventDefault() }}>{title}</a></h2>
          <div className={metaClassName}><small>{preview ? meta : 'Loading title…'}</small></div>
        </div>
      </article>
    })}
  </section>
}
