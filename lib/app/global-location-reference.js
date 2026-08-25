import { getGlobalLocationsByIds, isGlobalLocationSearchConfigured } from './global-location-search.js'

function useGlobal(env = process.env) {
  return isGlobalLocationSearchConfigured(env)
}

export async function ensureGlobalLocationReferences(admin, ids = []) {
  if (!useGlobal() || !admin) return { created: 0, missing: [], locations: [] }
  const values = [...new Set((ids || []).map(String).filter(Boolean))].slice(0, 1000)
  if (!values.length) return { created: 0, missing: [], locations: [] }

  // B2 serving is authoritative even when the tiny Supabase reference already exists.
  // Returning these rows lets callers use canonical coordinates transiently without
  // copying catalogue metadata into Postgres.
  const locations = await getGlobalLocationsByIds(values)
  const found = new Set(locations.map((row) => String(row.id)))
  const unresolved = values.filter((id) => !found.has(id))
  if (unresolved.length) throw new Error(`Global location reference lookup did not find ${unresolved.length} requested locations.`)

  const existing = await admin.from('location_refs').select('id').in('id', values)
  if (existing.error) throw existing.error
  const present = new Set((existing.data || []).map((row) => String(row.id)))
  const missing = values.filter((id) => !present.has(id))
  if (missing.length) {
    const inserted = await admin.from('location_refs').upsert(
      missing.map((id) => ({ id, kind: 'global' })),
      { onConflict: 'id', ignoreDuplicates: true }
    )
    if (inserted.error) throw inserted.error
  }
  return { created: missing.length, missing: [], locations }
}
