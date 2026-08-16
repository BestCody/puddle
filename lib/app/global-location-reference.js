import { getGlobalLocationsByIds, isGlobalLocationSearchConfigured } from './global-location-search.js'

function useGlobal(env = process.env) {
  return String(env.GLOBAL_LOCATION_SEARCH_ENABLED || '').toLowerCase() === 'true' && isGlobalLocationSearchConfigured(env)
}

export async function ensureGlobalLocationReferences(admin, ids = []) {
  if (!useGlobal() || !admin) return { created: 0, missing: [] }
  const values = [...new Set((ids || []).map(String).filter(Boolean))].slice(0, 1000)
  if (!values.length) return { created: 0, missing: [] }

  const existing = await admin.from('locations').select('id').in('id', values)
  if (existing.error) throw existing.error
  const present = new Set((existing.data || []).map((row) => String(row.id)))
  const missing = values.filter((id) => !present.has(id))
  if (!missing.length) return { created: 0, missing: [] }

  const globalRows = await getGlobalLocationsByIds(missing)
  const byId = new Map(globalRows.map((row) => [String(row.id), row]))
  const unresolved = missing.filter((id) => !byId.has(id))
  if (unresolved.length) throw new Error(`Global location reference lookup did not find ${unresolved.length} requested locations.`)

  const rows = missing.map((id) => {
    const row = byId.get(id)
    return {
      id,
      name: String(row.name || 'Puddle location').slice(0, 120),
      slug: String(row.slug || `global-${id}`).slice(0, 160),
      kind: String(row.category || 'attraction').slice(0, 60),
      city: String(row.city || row.region || row.country || 'Global').slice(0, 120),
      timezone: String(row.timezone || 'UTC').slice(0, 80),
      status: 'draft',
      visibility: 'public',
      source: 'global_ref',
      latitude: Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : null,
      longitude: Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : null,
      country_code: row.country_code || null,
      country: row.country || null,
      region: row.region || null,
      region_code: row.region_code || null,
      postal_code: row.postal_code || null,
      source_metadata: { global_reference_only: true }
    }
  })
  const inserted = await admin.from('locations').upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
  if (inserted.error) throw inserted.error
  return { created: rows.length, missing: [] }
}
