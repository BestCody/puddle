const CHUNK_SIZE = 200
const QUERY_CACHE_TTL_MS = 5_000
const QUERY_CACHE_MAX_ENTRIES = 64
const suspendedQueryCache = new Map()

function uniqueIds(rows = []) {
  return [...new Set(rows.map((row) => String(row?.id || row || '').trim()).filter(Boolean))]
}

function cacheKey(ids) {
  return [...ids].sort().join(',')
}

function pruneQueryCache(now = Date.now()) {
  for (const [key, entry] of suspendedQueryCache) {
    if (entry.expiresAt <= now) suspendedQueryCache.delete(key)
  }
  while (suspendedQueryCache.size > QUERY_CACHE_MAX_ENTRIES) {
    const oldest = suspendedQueryCache.keys().next().value
    if (oldest === undefined) break
    suspendedQueryCache.delete(oldest)
  }
}

async function querySuspendedLocationIds(supabase, ids) {
  const suspended = new Set()
  for (let offset = 0; offset < ids.length; offset += CHUNK_SIZE) {
    const chunk = ids.slice(offset, offset + CHUNK_SIZE)
    const { data, error } = await supabase
      .from('location_moderation_overrides')
      .select('location_id')
      .eq('state', 'suspended')
      .in('location_id', chunk)
    if (error) throw error
    for (const row of data || []) suspended.add(String(row.location_id))
  }
  return suspended
}

export async function suspendedLocationIds(supabase, rows = []) {
  if (!supabase) return new Set()
  const ids = uniqueIds(rows)
  if (!ids.length) return new Set()

  const now = Date.now()
  pruneQueryCache(now)
  const key = cacheKey(ids)
  const cached = suspendedQueryCache.get(key)
  if (cached?.expiresAt > now) return cached.promise

  // Concurrent viewport requests commonly contain the same candidate IDs. Share the
  // sparse-overlay lookup for a few seconds instead of issuing one PostgREST query per
  // request. The table is intentionally public-read and contains moderation state only.
  const promise = querySuspendedLocationIds(supabase, ids)
  suspendedQueryCache.set(key, { expiresAt: now + QUERY_CACHE_TTL_MS, promise })
  pruneQueryCache(now)

  try {
    return await promise
  } catch (error) {
    if (suspendedQueryCache.get(key)?.promise === promise) suspendedQueryCache.delete(key)
    throw error
  }
}

export async function filterModeratedLocationRows(supabase, rows = []) {
  const suspended = await suspendedLocationIds(supabase, rows)
  if (!suspended.size) return rows
  return rows.filter((row) => !suspended.has(String(row?.id || '')))
}

export async function isLocationSuspended(supabase, locationId) {
  if (!supabase || !locationId) return false
  const { data, error } = await supabase
    .from('location_moderation_overrides')
    .select('state')
    .eq('location_id', locationId)
    .maybeSingle()
  if (error) throw error
  return data?.state === 'suspended'
}
