import { getGlobalLocationsByIds, isGlobalLocationSearchConfigured } from './global-location-search.js'

function useGlobal(env = process.env) {
  return isGlobalLocationSearchConfigured(env)
}

export async function ensureGlobalLocationReferences(admin, ids = []) {
  if (!useGlobal() || !admin) return { created: 0, missing: [] }
  const values = [...new Set((ids || []).map(String).filter(Boolean))].slice(0, 1000)
  if (!values.length) return { created: 0, missing: [] }

  const existing = await admin.from('location_refs').select('id').in('id', values)
  if (existing.error) throw existing.error
  const present = new Set((existing.data || []).map((row) => String(row.id)))
  const missing = values.filter((id) => !present.has(id))
  if (!missing.length) return { created: 0, missing: [] }

  const globalRows = await getGlobalLocationsByIds(missing)
  const found = new Set(globalRows.map((row) => String(row.id)))
  const unresolved = missing.filter((id) => !found.has(id))
  if (unresolved.length) throw new Error(`Global location reference lookup did not find ${unresolved.length} requested locations.`)

  const inserted = await admin.from('location_refs').upsert(
    missing.map((id) => ({ id, kind: 'global' })),
    { onConflict: 'id', ignoreDuplicates: true }
  )
  if (inserted.error) throw inserted.error
  return { created: missing.length, missing: [] }
}
