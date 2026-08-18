import { getGlobalLocationsByIds } from '@/lib/app/global-location-search'
import { openPhotoUrlForHash } from '@/lib/media/open-photo-url'
import {
  SERVER_LATENCY_BUDGET_MS,
  createTraceId,
  elapsedMs,
  latencyStart,
  recordServerLatency,
  recordSloObservation
} from '@/lib/performance/server-latency'

export const LOCATION_HISTORY_PAGE_SIZE = 24
export const LOCATION_HISTORY_MAX_PAGE_SIZE = 40
const HYDRATION_SCAN_LIMIT = 8

function pageSize(value) {
  return Math.max(1, Math.min(Number(value) || LOCATION_HISTORY_PAGE_SIZE, LOCATION_HISTORY_MAX_PAGE_SIZE))
}

function encodeCursor(value) {
  if (!value) return null
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeCursor(value) {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || !parsed.at || !parsed.id) return null
    return parsed
  } catch {
    return null
  }
}

async function rpcPage(session, name, args, operation) {
  const started = latencyStart()
  const traceId = session.traceId || createTraceId()
  try {
    const { data, error } = await session.supabase.rpc(name, args)
    if (error) throw error
    const durationMs = elapsedMs(started)
    recordServerLatency(`supabase.${operation}`, durationMs, SERVER_LATENCY_BUDGET_MS.supabaseQuery, {
      trace_id: traceId, service: 'supabase', operation
    })
    return data || []
  } catch (error) {
    const durationMs = elapsedMs(started)
    recordServerLatency(`supabase.${operation}`, durationMs, SERVER_LATENCY_BUDGET_MS.supabaseQuery, {
      trace_id: traceId, service: 'supabase', operation, failed: true
    })
    recordSloObservation(operation, durationMs, false, { trace_id: traceId, service: 'supabase' })
    throw error
  }
}

function hydratedLocation(row) {
  const photo = row?.primary_photo && typeof row.primary_photo === 'object' ? row.primary_photo : {}
  return {
    name: row?.name || 'Location',
    slug: row?.slug || null,
    summary: row?.summary || row?.description || 'A saved location in your Puddle shortlist.',
    kind: row?.category || 'other',
    city: row?.city || row?.region || row?.country || null,
    cover_path: openPhotoUrlForHash(photo.content_hash)
  }
}

async function hydrateRows(rows, traceId) {
  const ids = [...new Set(rows.map((row) => String(row.location_id || '')).filter(Boolean))]
  const locations = await getGlobalLocationsByIds(ids, { traceId })
  const byId = new Map(locations.map((row) => [String(row.id), hydratedLocation(row)]))
  return rows.map((row) => ({ ...row, __location: byId.get(String(row.location_id)) || null }))
}

function matchesSavedFilters(row, category, query) {
  const location = row.__location
  if (!location) return false
  if (category && category !== 'all' && location.kind !== category) return false
  const term = String(query || '').trim().toLowerCase()
  if (!term) return true
  return [location.name, location.city, location.kind, location.summary]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(term)
}

function placeItem(row, overrides = {}) {
  const location = row.__location || {}
  return {
    id: row.location_id,
    location_id: row.location_id,
    kind: 'place',
    category: location.kind || 'other',
    title: location.name || 'Location',
    slug: location.slug || null,
    summary: location.summary || 'A saved location in your Puddle shortlist.',
    city: location.city || null,
    cover_path: location.cover_path || null,
    href: location.slug ? `/places/${location.slug}` : '/discover',
    ...overrides
  }
}

function rowCursor(tab, row) {
  if (!row) return null
  if (tab === 'saved') {
    return { pinned: Boolean(row.cursor_pinned), at: row.cursor_at, id: row.cursor_id }
  }
  return { at: row.cursor_at, id: row.cursor_id }
}

function nextCursor(tab, row) {
  return encodeCursor(rowCursor(tab, row))
}

async function rawRows(session, active, cursor, requested) {
  if (active === 'saved') {
    return rpcPage(session, 'location_saved_page_v1', {
      before_pinned: cursor ? Boolean(cursor.pinned) : null,
      before_sort_at: cursor?.at || null,
      before_location_id: cursor?.id || null,
      result_limit: requested,
      category_filter: null,
      search_term: null
    }, 'savedHistory')
  }
  if (active === 'planned') {
    return rpcPage(session, 'location_planned_page_v1', {
      after_sort_at: cursor?.at || null,
      after_location_id: cursor?.id || null,
      result_limit: requested
    }, 'plannedHistory')
  }
  return rpcPage(session, 'location_history_page_v1', {
    before_sort_at: cursor?.at || null,
    before_location_id: cursor?.id || null,
    result_limit: requested
  }, 'pastHistory')
}

export async function getLocationPlansPage(session, {
  tab = 'saved',
  cursor = null,
  limit = LOCATION_HISTORY_PAGE_SIZE,
  category = null,
  query = ''
} = {}) {
  const active = tab === 'planned' ? 'planned' : tab === 'past' ? 'past' : 'saved'
  const size = pageSize(limit)
  const requested = Math.min(LOCATION_HISTORY_MAX_PAGE_SIZE + 1, size + 1)
  const traceId = session.traceId || createTraceId()
  const started = latencyStart()
  let scanCursor = decodeCursor(cursor)
  const collected = []
  let rawHasMore = false

  for (let scan = 0; scan < HYDRATION_SCAN_LIMIT && collected.length <= size; scan += 1) {
    const batch = await rawRows(session, active, scanCursor, requested)
    rawHasMore = batch.length >= requested
    if (!batch.length) break
    const hydrated = await hydrateRows(batch, traceId)
    for (const row of hydrated) {
      if (!row.__location) continue
      if (active === 'saved' && !matchesSavedFilters(row, category, query)) continue
      collected.push(row)
      if (collected.length > size) break
    }
    if (collected.length > size || !rawHasMore) break
    scanCursor = rowCursor(active, batch[batch.length - 1])
  }

  const hasMore = collected.length > size || rawHasMore
  const pageRows = collected.slice(0, size)
  const items = pageRows.map((row) => {
    if (active === 'saved') {
      return placeItem(row, {
        saved_at: row.saved_at,
        pinned_at: row.pinned_at || null,
        pinned: Boolean(row.pinned_at),
        perfect_pick: Boolean(row.perfect_pick)
      })
    }
    if (active === 'planned') {
      return placeItem(row, {
        status: 'planned',
        planned_for: row.planned_for,
        plan_source: row.plan_source,
        participants: Array.isArray(row.participants) ? row.participants : ['You']
      })
    }
    return placeItem(row, {
      status: 'visited',
      visited_at: row.visited_at,
      visit_source: row.visit_source,
      participants: Array.isArray(row.participants) ? row.participants : ['You']
    })
  })

  recordSloObservation('savedHistory', elapsedMs(started), true, {
    trace_id: traceId, service: 'vercel', tab: active, page_size: size,
    returned: items.length, has_more: hasMore
  })

  return {
    items,
    pagination: {
      pageSize: size,
      hasMore,
      nextCursor: hasMore && pageRows.length ? nextCursor(active, pageRows[pageRows.length - 1]) : null
    }
  }
}

export async function getLocationPlanStatus(session, locationId) {
  if (!locationId) return null
  const rows = await rpcPage(session, 'location_plan_status_v1', { target_location: locationId }, 'locationPlanStatus')
  const row = rows[0]
  if (!row) return null
  return {
    status: row.status,
    planned_for: row.planned_for,
    plan_source: row.plan_source,
    participants: Array.isArray(row.participants) ? row.participants : ['You']
  }
}

export async function getLocationPlansSnapshot(session) {
  const [savedPage, plannedPage, pastPage] = await Promise.all([
    getLocationPlansPage(session, { tab: 'saved' }),
    getLocationPlansPage(session, { tab: 'planned' }),
    getLocationPlansPage(session, { tab: 'past' })
  ])
  return {
    saved: savedPage.items,
    planned: plannedPage.items,
    past: pastPage.items,
    counts: { saved: savedPage.items.length, planned: plannedPage.items.length, past: pastPage.items.length },
    pagination: { saved: savedPage.pagination, planned: plannedPage.pagination, past: pastPage.pagination }
  }
}
