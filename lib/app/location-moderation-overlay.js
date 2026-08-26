import { unstable_cache } from 'next/cache'
import { createPublicClient } from '@/lib/supabase/public'

const CHUNK_SIZE = 200

function uniqueIds(rows = []) {
  return [...new Set(rows.map((row) => String(row?.id || row || '').trim()).filter(Boolean))]
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

const cachedPublicSuspendedLocationIds = unstable_cache(
  async (serializedIds) => [...await querySuspendedLocationIds(createPublicClient(), JSON.parse(serializedIds))],
  ['public-suspended-location-ids-v1'],
  { revalidate: 5, tags: ['location-moderation'] }
)

export async function suspendedLocationIds(supabase, rows = []) {
  if (!supabase) return new Set()
  const ids = uniqueIds(rows).sort()
  if (!ids.length) return new Set()
  return new Set(await cachedPublicSuspendedLocationIds(JSON.stringify(ids)))
}

export async function filterModeratedLocationRows(supabase, rows = []) {
  const suspended = await suspendedLocationIds(supabase, rows)
  if (!suspended.size) return rows
  return rows.filter((row) => !suspended.has(String(row?.id || '')))
}

export async function isLocationSuspended(supabase, locationId) {
  if (!supabase || !locationId) return false
  return (await suspendedLocationIds(supabase, [locationId])).has(String(locationId))
}
