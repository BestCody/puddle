import { getGlobalLocationsByIds, isGlobalLocationSearchConfigured } from './global-location-search.js'

function useGlobal(env = process.env) {
  return isGlobalLocationSearchConfigured(env)
}

export async function ensureGlobalLocationReferences(admin, ids = []) {
  if (!useGlobal() || !admin) return { created: 0, missing: [], locations: [] }
  const values = [...new Set((ids || []).map(String).filter(Boolean))].slice(0, 1000)
  if (!values.length) return { created: 0, missing: [], locations: [] }

  // B2 remains authoritative. The small reference index holds only the fields
  // needed to filter a user's saved locations before pagination.
  const locations = await getGlobalLocationsByIds(values)
  const found = new Set(locations.map((row) => String(row.id)))
  const unresolved = values.filter((id) => !found.has(id))
  if (unresolved.length) throw new Error(`Global location reference lookup did not find ${unresolved.length} requested locations.`)

  const existing = await admin.from('location_refs').select('id,name').in('id', values)
  if (existing.error) throw existing.error
  const present = new Map((existing.data || []).map((row) => [String(row.id), row]))
  const missing = values.filter((id) => !present.has(id))
  const metadata = locations.filter((row) => !present.get(String(row.id))?.name).map((row) => ({
    id: row.id,
    kind: 'global',
    name: String(row.name || '').slice(0, 300),
    slug: String(row.slug || '').slice(0, 400),
    category: String(row.category || row.kind || 'other').slice(0, 80),
    city: String(row.city || '').slice(0, 160)
  }))
  if (metadata.length) {
    const indexed = await admin.from('location_refs').upsert(metadata, { onConflict: 'id' })
    if (indexed.error) throw indexed.error
  }
  return { created: missing.length, missing: [], locations }
}
