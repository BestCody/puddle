#!/usr/bin/env node
// Reports which serving mode each parity city uses when all text accelerators
// are pointed at their candidates. Fails loudly if any exact/prefix-capable
// query silently lands on a scan path.
import { searchGlobalLocations } from '../../lib/app/global-location-search.js'

const env = {
  ...process.env,
  GLOBAL_LOCATION_SEARCH_BACKEND: 'b2'
}

const cases = [
  ['toronto', 43.6532, -79.3832, 25],
  ['toronto-suburbs', 43.7615, -79.4111, 25],
  ['new-york', 40.7128, -74.0060, 25],
  ['london', 51.5074, -0.1278, 25],
  ['tokyo', 35.6762, 139.6503, 25],
  ['reykjavik', 64.1466, -21.9426, 40]
]

for (const [name, latitude, longitude, distanceKm] of cases) {
  const result = await searchGlobalLocations({
    latitude,
    longitude,
    distanceKm,
    filters: {},
    candidateLimit: 20
  }, { env })
  const diagnostics = result.diagnostics || {}
  console.log(`serving_mode city=${name} mode=${diagnostics.textMode || 'none'} prune=${diagnostics.textPrune} prunedShards=${diagnostics.textPrunedShards} refs=${diagnostics.textPostingRefs} count=${result.candidates.length} tookMs=${result.tookMs}`)
}
