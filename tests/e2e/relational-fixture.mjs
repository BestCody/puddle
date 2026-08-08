import { staticCatalogueMaterializationItem } from '../../lib/app/static-catalogue-bulk-materialization.js'
import { admin } from './support.mjs'
import { R2_FIXTURE_RELEASE } from './r2-fixture-data.mjs'

export async function ensureRelationalFixturePlaces(places) {
  const items = (places || []).map((place) => staticCatalogueMaterializationItem(place, {
    release: R2_FIXTURE_RELEASE,
    detail: place,
    provenance: place
  })).filter(Boolean)

  if (!items.length) throw new Error('Relational E2E fixture places are required.')

  const { data, error } = await admin.rpc('materialize_static_catalogue_locations_v2', { items })
  if (error) throw error
  if (!Array.isArray(data) || data.length !== items.length) {
    throw new Error('Supabase did not materialize the complete relational E2E fixture set.')
  }

  return data
}
