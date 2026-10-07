import { getGlobalLocationsByIds, isGlobalLocationSearchConfigured } from './global-location-search.js'

function useGlobal(env = process.env) {
  return isGlobalLocationSearchConfigured(env)
}

export async function ensureGlobalLocationReferences(admin, ids = []) {
  if (!useGlobal() || !admin) return { created: 0, missing: [], locations: [] }
  const values = [...new Set((ids || []).map(String).filter(Boolean))].slice(0, 1000)
  if (!values.length) return { created: 0, missing: [], locations: [] }

  // object store remains authoritative. The FK registry stays ID-only; the separate
  // derived index holds the small subset needed for saved-list filtering.
  const locations = await getGlobalLocationsByIds(values)
  const found = new Set(locations.map((row) => String(row.id)))
  const unresolved = values.filter((id) => !found.has(id))
  if (unresolved.length) throw new Error(`Global location reference lookup did not find ${unresolved.length} requested locations.`)

  const [existing, indexed] = await Promise.all([
    admin.from('location_refs').select('id').in('id', values),
    admin.from('location_ref_search_index').select('location_id').in('location_id', values)
  ])
  if (existing.error) throw existing.error
  if (indexed.error) throw indexed.error
  const present = new Set((existing.data || []).map((row) => String(row.id)))
  const missing = values.filter((id) => !present.has(id))
  if (missing.length) {
    const inserted = await admin.from('location_refs').upsert(
      missing.map((id) => ({ id, kind: 'global' })),
      { onConflict: 'id', ignoreDuplicates: true }
    )
    if (inserted.error) throw inserted.error
  }
  const indexedIds = new Set((indexed.data || []).map((row) => String(row.location_id)))
  const metadata = locations.filter((row) => !indexedIds.has(String(row.id))).map((row) => ({
    location_id: row.id,
    name: String(row.name || '').slice(0, 300),
    slug: String(row.slug || '').slice(0, 400),
    category: String(row.category || row.kind || 'other').slice(0, 80),
    city: String(row.city || '').slice(0, 160)
  }))
  if (metadata.length) {
    const written = await admin.from('location_ref_search_index').upsert(metadata, { onConflict: 'location_id' })
    if (written.error) throw written.error
  }
  return { created: missing.length, missing: [], locations }
}
