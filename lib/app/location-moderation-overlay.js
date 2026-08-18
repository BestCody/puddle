const CHUNK_SIZE = 200

function uniqueIds(rows = []) {
  return [...new Set(rows.map((row) => String(row?.id || row || '').trim()).filter(Boolean))]
}

export async function suspendedLocationIds(supabase, rows = []) {
  if (!supabase) return new Set()
  const ids = uniqueIds(rows)
  if (!ids.length) return new Set()
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
