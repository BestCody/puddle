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
      trace_id: traceId,
      service: 'supabase',
      operation
    })
    return data || []
  } catch (error) {
    const durationMs = elapsedMs(started)
    recordServerLatency(`supabase.${operation}`, durationMs, SERVER_LATENCY_BUDGET_MS.supabaseQuery, {
      trace_id: traceId,
      service: 'supabase',
      operation,
      failed: true
    })
    recordSloObservation(operation, durationMs, false, { trace_id: traceId, service: 'supabase' })
    throw error
  }
}

function placeItem(row, overrides = {}) {
  return {
    id: row.location_id,
    location_id: row.location_id,
    kind: 'place',
    category: row.kind || 'other',
    title: row.name || 'Location',
    slug: row.slug || null,
    summary: row.summary || 'A saved location in your Puddle shortlist.',
    city: row.city || null,
    cover_path: row.cover_path || null,
    href: row.slug ? `/plans/${row.slug}` : '/discover',
    ...overrides
  }
}

function nextCursor(tab, row) {
  if (!row) return null
  if (tab === 'saved') {
    return encodeCursor({
      pinned: Boolean(row.cursor_pinned),
      at: row.cursor_at,
      id: row.cursor_id
    })
  }
  return encodeCursor({ at: row.cursor_at, id: row.cursor_id })
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
  const decoded = decodeCursor(cursor)
  const requested = size + 1
  const started = latencyStart()
  const traceId = session.traceId || createTraceId()
  let rows

  if (active === 'saved') {
    rows = await rpcPage(session, 'location_saved_page_v1', {
      before_pinned: decoded ? Boolean(decoded.pinned) : null,
      before_sort_at: decoded?.at || null,
      before_location_id: decoded?.id || null,
      result_limit: requested,
      category_filter: category && category !== 'all' ? String(category) : null,
      search_term: String(query || '').trim() || null
    }, 'savedHistory')
  } else if (active === 'planned') {
    rows = await rpcPage(session, 'location_planned_page_v1', {
      after_sort_at: decoded?.at || null,
      after_location_id: decoded?.id || null,
      result_limit: requested
    }, 'plannedHistory')
  } else {
    rows = await rpcPage(session, 'location_history_page_v1', {
      before_sort_at: decoded?.at || null,
      before_location_id: decoded?.id || null,
      result_limit: requested
    }, 'pastHistory')
  }

  const hasMore = rows.length > size
  const pageRows = rows.slice(0, size)
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

  const durationMs = elapsedMs(started)
  recordSloObservation('savedHistory', durationMs, true, {
    trace_id: traceId,
    service: 'vercel',
    tab: active,
    page_size: size,
    returned: items.length,
    has_more: hasMore
  })

  return {
    items,
    pagination: {
      pageSize: size,
      hasMore,
      nextCursor: hasMore ? nextCursor(active, pageRows[pageRows.length - 1]) : null
    }
  }
}

export async function getLocationPlanStatus(session, locationId) {
  if (!locationId) return null
  const rows = await rpcPage(session, 'location_plan_status_v1', {
    target_location: locationId
  }, 'locationPlanStatus')
  const row = rows[0]
  if (!row) return null
  return {
    status: row.status,
    planned_for: row.planned_for,
    plan_source: row.plan_source,
    participants: Array.isArray(row.participants) ? row.participants : ['You']
  }
}

// Compatibility for any remaining callers: still bounded to one first page per collection.
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
    counts: {
      saved: savedPage.items.length,
      planned: plannedPage.items.length,
      past: pastPage.items.length
    },
    pagination: {
      saved: savedPage.pagination,
      planned: plannedPage.pagination,
      past: pastPage.pagination
    }
  }
}
