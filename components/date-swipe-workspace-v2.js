"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DiscoveryPhotoPreloader } from '@/components/discovery-photo-preloader'
import { FigmaSwipeCard } from '@/components/figma-swipe-card'
import { SwipeActionDock } from '@/components/swipe-action-dock'
import { DiscoveryFilterSheet } from '@/components/discovery-filter-sheet'
import { csrfFetch } from '@/lib/security/csrf-client'

const ACTION_BATCH_DELAY_MS = 350
const ACTION_BATCH_SIZE = 20
const ACTION_RETRY_BASE_MS = 1_000
const ACTION_RETRY_MAX_MS = 30_000
const ACTION_STORAGE_PREFIX = 'puddle:pending-discovery-actions:v1'
const DECK_BATCH_SIZE = 12
const REFILL_THRESHOLD = 5
const PHOTO_PRELOAD_AHEAD = 2
const MAX_SEARCH_DISTANCE_KM = 20_040

function queryString(filters) {
  const params = new URLSearchParams({ kind: 'place', date: 'any' })
  for (const [key, value] of Object.entries(filters)) {
    if (value !== '' && value !== false && value !== null && value !== undefined) params.set(key, String(value))
  }
  return params.toString()
}

function withRequestId(items, requestId) {
  return (items || []).map((item) => ({ ...item, __discovery_request_id: requestId || null }))
}

function daypart() {
  const hour = new Date().getHours()
  if (hour >= 5 && hour <= 11) return 'morning'
  if (hour >= 12 && hour <= 16) return 'afternoon'
  if (hour >= 17 && hour <= 22) return 'evening'
  return 'late'
}

function actionStorageKey(profileId) {
  const owner = String(profileId || '').trim()
  return owner ? `${ACTION_STORAGE_PREFIX}:${owner}` : null
}

function storedDiscoveryActions(storageKey) {
  if (typeof window === 'undefined' || !storageKey) return []
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) || '[]')
    if (!Array.isArray(value)) return []
    return value.filter((item) => item && typeof item === 'object' && item.eventId && item.contentId && item.action)
  } catch {
    return []
  }
}

function persistDiscoveryActions(entries, storageKey) {
  if (typeof window === 'undefined' || !storageKey) return
  try {
    const payloads = entries.map((entry) => entry.payload).filter(Boolean)
    if (payloads.length) window.localStorage.setItem(storageKey, JSON.stringify(payloads))
    else window.localStorage.removeItem(storageKey)
  } catch {
    // Local persistence is only the retry layer. The server acknowledgement queue remains authoritative.
  }
}

function retryDelay(attempt, retryAfterSeconds = 0) {
  const requested = Number(retryAfterSeconds) * 1_000
  if (Number.isFinite(requested) && requested > 0) return Math.min(ACTION_RETRY_MAX_MS, requested)
  return Math.min(ACTION_RETRY_MAX_MS, ACTION_RETRY_BASE_MS * (2 ** Math.min(5, attempt)))
}

function EmptyDeck({ feed, onRefresh, onFilters, onExpand, exhausted = false }) {
  let title = 'No places found'
  let description = ''
  if (feed.emptyReason === 'location_required') {
    title = 'Choose your location'
    description = 'Puddle needs a city or your current location before it can find nearby places.'
  } else if (feed.emptyReason === 'catalogue_sync_pending') {
    title = 'Places are being added nearby'
    description = 'No places are available around the selected location yet.'
  } else if (!exhausted && feed.emptyReason === 'filters') {
    title = 'No places match these filters'
  } else if (exhausted) {
    title = "You've seen all nearby places"
    description = Number(feed.filters?.distance) < MAX_SEARCH_DISTANCE_KM
      ? `That's everything in the current ${feed.filters?.distance || 10} km search.`
      : 'That is everything available for the current filters.'
  }

  return <div className="figma-swipe-empty" aria-live="polite">
    <h1>{title}</h1>
    {description ? <p>{description}</p> : null}
    <div>
      {exhausted && Number(feed.filters?.distance) < MAX_SEARCH_DISTANCE_KM ? <button type="button" onClick={onExpand}>Expand distance</button> : null}
      <button type="button" onClick={onFilters}>{feed.emptyReason === 'location_required' ? 'Choose location' : 'Change filters'}</button>
      {feed.emptyReason !== 'location_required' && !exhausted ? <button type="button" onClick={onRefresh}>Try again</button> : null}
    </div>
  </div>
}

export function DateSwipeWorkspaceV2({ initialFeed, profileId }) {
  const initialItems = initialFeed.items.slice(0, DECK_BATCH_SIZE)
  const [feed, setFeed] = useState({ ...initialFeed, items: withRequestId(initialItems, initialFeed.requestId) })
  const [filters, setFilters] = useState({
    ...initialFeed.filters,
    q: '',
    latitude: initialFeed.center?.latitude ?? initialFeed.filters?.latitude ?? null,
    longitude: initialFeed.center?.longitude ?? initialFeed.filters?.longitude ?? null,
    locationLabel: initialFeed.filters?.locationLabel || initialFeed.centerLabel || '',
    kind: 'place',
    date: 'any',
    limit: DECK_BATCH_SIZE
  })
  const [index, setIndex] = useState(0)
  const [choices, setChoices] = useState({})
  const [showFilters, setShowFilters] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(initialFeed.continuation?.hasMore === false && initialItems.length < DECK_BATCH_SIZE && initialItems.length > 0)
  const [message, setMessage] = useState('')
  const [actionRequest, setActionRequest] = useState(null)

  const storageKey = useMemo(() => actionStorageKey(profileId), [profileId])
  const actionBuffer = useRef([])
  const actionSequence = useRef(0)
  const actionRequestSequence = useRef(0)
  const flushTimer = useRef(null)
  const retryTimer = useRef(null)
  const retryAttempt = useRef(0)
  const inFlight = useRef(Promise.resolve())
  const pendingItems = useRef(new Set())
  const continuationInFlight = useRef(null)
  const deckGeneration = useRef(0)
  const sessionIds = useRef(new Set(initialItems.map((item) => item.content_id)))

  const current = feed.items[index] || null
  const categories = useMemo(() => [...new Set([...(feed.categories || []), ...feed.items.map((item) => item.category).filter(Boolean)])].sort(), [feed])
  const busy = false

  useEffect(() => {
    if (!message) return undefined
    const timer = window.setTimeout(() => setMessage(''), 2400)
    return () => window.clearTimeout(timer)
  }, [message])

  const flushActions = useCallback(({ keepalive = false } = {}) => {
    if (flushTimer.current) {
      window.clearTimeout(flushTimer.current)
      flushTimer.current = null
    }
    if (retryTimer.current && !keepalive) {
      window.clearTimeout(retryTimer.current)
      retryTimer.current = null
    }
    if (!actionBuffer.current.length) return inFlight.current

    const entries = actionBuffer.current.slice(0, ACTION_BATCH_SIZE)
    const task = async () => {
      const response = await csrfFetch('/api/discovery/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions: entries.map((entry) => entry.payload) }),
        keepalive
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        const error = new Error(result.error || 'Could not save those choices.')
        error.status = response.status
        error.retryAfter = Number(response.headers.get('retry-after') || 0)
        throw error
      }

      actionBuffer.current.splice(0, entries.length)
      persistDiscoveryActions(actionBuffer.current, storageKey)
      retryAttempt.current = 0
      for (const entry of entries) {
        if (entry.itemKey) pendingItems.current.delete(entry.itemKey)
        entry.resolve(result)
      }
      return result
    }

    inFlight.current = inFlight.current.catch(() => {}).then(task).catch((error) => {
      const status = Number(error?.status || 0)
      const retryable = !status || status === 408 || status === 425 || status === 429 || status >= 500
      if (retryable) {
        const delay = retryDelay(retryAttempt.current++, error?.retryAfter)
        setMessage('Saving your choices…')
        if (!keepalive) retryTimer.current = window.setTimeout(() => {
          retryTimer.current = null
          flushActions()
        }, delay)
        return null
      }

      actionBuffer.current.splice(0, entries.length)
      persistDiscoveryActions(actionBuffer.current, storageKey)
      setMessage(error.message)
      for (const entry of entries) {
        if (entry.itemKey) pendingItems.current.delete(entry.itemKey)
        entry.resolve(null)
      }
      return null
    }).finally(() => {
      if (actionBuffer.current.length && !retryTimer.current && !keepalive) flushActions()
    })
    return inFlight.current
  }, [storageKey])

  const queueDiscoveryAction = useCallback((payload, itemKey) => {
    const sequence = actionSequence.current++
    return new Promise((resolve) => {
      actionBuffer.current.push({ itemKey, resolve, payload: { ...payload, eventId: crypto.randomUUID(), sequence } })
      persistDiscoveryActions(actionBuffer.current, storageKey)
      if (actionBuffer.current.length >= ACTION_BATCH_SIZE) flushActions()
      else if (!flushTimer.current) flushTimer.current = window.setTimeout(() => flushActions(), ACTION_BATCH_DELAY_MS)
    })
  }, [flushActions, storageKey])

  useEffect(() => {
    const restored = storedDiscoveryActions(storageKey)
    if (!restored.length) return
    const existing = new Set(actionBuffer.current.map((entry) => entry.payload?.eventId))
    for (const payload of restored) {
      if (existing.has(payload.eventId)) continue
      actionBuffer.current.push({ itemKey: null, payload, resolve: () => {} })
      actionSequence.current = Math.max(actionSequence.current, Number(payload.sequence || 0) + 1)
    }
    persistDiscoveryActions(actionBuffer.current, storageKey)
    flushActions()
  }, [flushActions, storageKey])

  const drainActions = useCallback(async () => {
    await flushActions()
    await inFlight.current.catch(() => {})
  }, [flushActions])

  const loadMore = useCallback(async () => {
    if (continuationInFlight.current || exhausted) return continuationInFlight.current
    const generation = deckGeneration.current
    const normalized = { ...filters, q: '', kind: 'place', date: 'any', limit: DECK_BATCH_SIZE }
    setLoadingMore(true)

    const task = (async () => {
      await drainActions()
      if (generation !== deckGeneration.current) return null
      const visibleIds = feed.items.slice(index).map((item) => item?.content_id).filter(Boolean)
      const pendingActionIds = actionBuffer.current.map((entry) => entry.payload?.contentId).filter(Boolean)
      const excludeIds = [...new Set([...visibleIds, ...pendingActionIds])]
      const response = await csrfFetch('/api/discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: normalized, excludeIds })
      })
      const result = await response.json().catch(() => ({}))
      if (generation !== deckGeneration.current) return null
      if (!response.ok) {
        setMessage(result.error || 'Could not load more places.')
        return null
      }
      const nextItems = (result.items || []).filter((item) => item?.content_id && !sessionIds.current.has(item.content_id)).slice(0, DECK_BATCH_SIZE)
      for (const item of nextItems) sessionIds.current.add(item.content_id)
      if (nextItems.length) {
        const annotated = withRequestId(nextItems, result.requestId)
        setFeed((value) => ({
          ...value,
          items: [...value.items, ...annotated],
          categories: [...new Set([...(value.categories || []), ...(result.categories || [])])].sort(),
          infrastructure: result.infrastructure || value.infrastructure,
          continuation: result.continuation || value.continuation
        }))
      }
      if (result.continuation?.hasMore === false || (!nextItems.length && !(result.items || []).length)) setExhausted(true)
      return result
    })().finally(() => {
      if (generation === deckGeneration.current) setLoadingMore(false)
      continuationInFlight.current = null
    })
    continuationInFlight.current = task
    return task
  }, [filters, exhausted, drainActions, feed.items, index])

  useEffect(() => {
    if (exhausted || loadingMore) return
    if (Math.max(0, feed.items.length - index) <= REFILL_THRESHOLD) loadMore().catch(() => {})
  }, [feed.items.length, index, exhausted, loadingMore, loadMore])

  useEffect(() => {
    const flushBeforeLeaving = () => {
      persistDiscoveryActions(actionBuffer.current, storageKey)
      if (actionBuffer.current.length) flushActions({ keepalive: true })
    }
    const visibility = () => { if (document.visibilityState === 'hidden') flushBeforeLeaving() }
    window.addEventListener('pagehide', flushBeforeLeaving)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('pagehide', flushBeforeLeaving)
      document.removeEventListener('visibilitychange', visibility)
      persistDiscoveryActions(actionBuffer.current, storageKey)
      if (flushTimer.current) window.clearTimeout(flushTimer.current)
      if (retryTimer.current) window.clearTimeout(retryTimer.current)
    }
  }, [flushActions, storageKey])

  function requestChoice(action) {
    if (!current || busy) return
    actionRequestSequence.current += 1
    setActionRequest({ action, id: actionRequestSequence.current })
  }

  function updateFilter(name, value) {
    setFilters((valueBefore) => ({ ...valueBefore, [name]: value, q: '', kind: 'place', date: 'any', limit: DECK_BATCH_SIZE }))
  }

  function context(item) {
    return { mode: 'solo', category: item?.category || filters.category || null, mood: null, price: filters.price || 'any', daypart: daypart(), source: 'swipe' }
  }

  async function refresh(nextFilters = filters) {
    setLoading(true)
    deckGeneration.current += 1
    await drainActions()
    const normalized = { ...nextFilters, q: '', kind: 'place', date: 'any', limit: DECK_BATCH_SIZE }
    const response = await fetch(`/api/discovery?${queryString(normalized)}`, { cache: 'no-store' })
    const result = await response.json().catch(() => ({}))
    setLoading(false)
    if (!response.ok) return setMessage(result.error || 'Could not load a new deck.')
    const nextItems = (result.items || []).slice(0, DECK_BATCH_SIZE)
    sessionIds.current = new Set(nextItems.map((item) => item.content_id))
    setFeed({ ...result, items: withRequestId(nextItems, result.requestId) })
    setFilters({ ...result.filters, q: '', kind: 'place', date: 'any', limit: DECK_BATCH_SIZE })
    setIndex(0)
    setChoices({})
    setShowFilters(false)
    setExhausted(result.continuation?.hasMore === false && nextItems.length < DECK_BATCH_SIZE && nextItems.length > 0)
    setMessage('')
  }

  function persistChoice(action, item) {
    if (!item || busy || pendingItems.current.has(item.content_id)) return
    pendingItems.current.add(item.content_id)
    const persistedAction = action === 'pass' ? 'dismissed' : action === 'perfect' ? 'perfect' : 'saved'
    setChoices((value) => ({ ...value, [item.content_id]: { choice: action, note: '' } }))
    setIndex((value) => value + 1)
    queueDiscoveryAction({
      action: persistedAction,
      contentKind: 'place',
      contentId: item.content_id,
      requestId: item.__discovery_request_id || feed.requestId,
      context: context(item)
    }, item.content_id).then((result) => {
      if (result) return
      setChoices((value) => {
        const next = { ...value }
        delete next[item.content_id]
        return next
      })
    })
  }

  function undo() {
    const previousIndex = Math.max(0, index - 1)
    const item = feed.items[previousIndex]
    if (!item || index === 0 || busy || pendingItems.current.has(`undo:${item.content_id}`)) return
    const previousChoice = choices[item.content_id]
    pendingItems.current.add(`undo:${item.content_id}`)
    setIndex(previousIndex)
    setChoices((value) => { const next = { ...value }; delete next[item.content_id]; return next })
    queueDiscoveryAction({
      action: 'undo',
      contentKind: 'place',
      contentId: item.content_id,
      requestId: item.__discovery_request_id || feed.requestId
    }, `undo:${item.content_id}`).then((result) => {
      if (result) return
      setIndex((value) => Math.max(value, previousIndex + 1))
      if (previousChoice) setChoices((value) => ({ ...value, [item.content_id]: previousChoice }))
    })
  }

  function expandDistance() {
    const currentDistance = Number(filters.distance || 10)
    const distance = Math.min(MAX_SEARCH_DISTANCE_KM, Math.max(currentDistance + 5, currentDistance * 2))
    refresh({ ...filters, distance })
  }

  useEffect(() => {
    function keyboard(event) {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (!current || busy || event.metaKey || event.ctrlKey || event.altKey || target?.closest('input,textarea,select,button')) return
      if (event.key === 'ArrowLeft') requestChoice('pass')
      if (event.key === 'ArrowRight') requestChoice('save')
      if (event.key.toLowerCase() === 'p') requestChoice('perfect')
      if (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'u') undo()
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  })

  const deckComplete = feed.items.length > 0 && !current && exhausted
  const waitingForMore = feed.items.length > 0 && !current && !exhausted

  return <section className="figma-swipe-screen">
    <DiscoveryPhotoPreloader items={feed.items} index={index} ahead={PHOTO_PRELOAD_AHEAD} />
    <div className="figma-swipe-workspace">
      <button className="figma-swipe-filter-trigger" type="button" onClick={() => setShowFilters(true)} aria-label="Open filters">Filters</button>

      {current ? <>
        <div className="figma-swipe-card-stage"><FigmaSwipeCard item={current} onChoice={persistChoice} busy={busy} actionRequest={actionRequest} /></div>
        <SwipeActionDock
          onUndo={undo}
          onPass={() => requestChoice('pass')}
          onSave={() => requestChoice('save')}
          onPerfect={() => requestChoice('perfect')}
          canUndo={index > 0}
          busy={busy}
        />
        <span className="figma-swipe-status" aria-live="polite">{message}</span>
      </> : waitingForMore ? <div className="figma-swipe-empty" aria-live="polite"><h1>Loading more places…</h1></div>
        : deckComplete ? <EmptyDeck feed={feed} exhausted onRefresh={() => refresh()} onFilters={() => setShowFilters(true)} onExpand={expandDistance} />
          : <EmptyDeck feed={feed} onRefresh={() => refresh()} onFilters={() => setShowFilters(true)} onExpand={expandDistance} />}

      {showFilters ? <DiscoveryFilterSheet filters={filters} categories={categories} onChange={updateFilter} onApply={() => refresh(filters)} onClose={() => setShowFilters(false)} loading={loading} /> : null}
    </div>
  </section>
}
