"use client"

import { useMemo, useRef, useState } from 'react'
import { SavedLightweightGrid } from '@/components/saved-lightweight-grid'

export function SavedPagedGrid({ initialItems, initialPagination, category, query, classes }) {
  const [items, setItems] = useState(initialItems)
  const [pagination, setPagination] = useState(initialPagination)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)

  async function loadMore() {
    if (inFlight.current || !pagination.hasMore || !pagination.nextCursor) return
    inFlight.current = true
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ cursor: pagination.nextCursor })
      if (category && category !== 'all') params.set('category', category)
      if (query) params.set('q', query)
      const response = await fetch(`/api/saved-page?${params}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('Saved page unavailable')
      const page = await response.json()
      if (!Array.isArray(page.items) || !page.pagination) throw new Error('Invalid saved page')
      setItems((current) => {
        const seen = new Set(current.map((item) => item.location_id))
        return [...current, ...page.items.filter((item) => !seen.has(item.location_id))]
      })
      setPagination(page.pagination)
    } catch {
      setError('Could not load more saved places. Try again.')
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }

  const initialPreviews = useMemo(() => Object.fromEntries(initialItems.filter((item) => item.slug).map((item) => [String(item.location_id), {
    title: item.title, slug: item.slug, city: item.city, category: item.category, latitude: item.latitude, longitude: item.longitude
  }])), [initialItems])

  return <>
    <SavedLightweightGrid
      items={items}
      className={classes.grid}
      cardClassName={classes.card}
      photoClassName={classes.photo}
      copyClassName={classes.copy}
      metaClassName={classes.meta}
      perfectPickClassName={classes.perfectPick}
      initialPreviews={initialPreviews}
    />
    {pagination.hasMore ? <div className={classes.loadMore}>
      <button type="button" onClick={loadMore} disabled={loading} data-testid="saved-next-page">
        {loading ? 'Loading saved places…' : 'Load more saved places'}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div> : null}
  </>
}
