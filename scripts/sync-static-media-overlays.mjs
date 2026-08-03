import { createAdminClient } from '../lib/supabase/admin.js'
import { syncStaticMediaOverlayForLocations } from '../lib/app/static-media-overlay.js'

const locationArgument = process.argv.find((value) => value.startsWith('--location='))?.split('=')[1] || null
const limitArgument = process.argv.find((value) => value.startsWith('--limit='))?.split('=')[1]
const LIMIT = Math.max(1, Math.min(5_000, Number(limitArgument || process.env.STATIC_MEDIA_SYNC_LIMIT || 250)))
const admin = createAdminClient()

let locationIds
if (locationArgument) {
  locationIds = [locationArgument]
} else {
  const [photos, google] = await Promise.all([
    admin.from('location_photo_sources')
      .select('location_id')
      .eq('status', 'approved')
      .not('media_object_id', 'is', null)
      .order('verified_at', { ascending: false })
      .limit(LIMIT),
    admin.from('location_google_places')
      .select('location_id')
      .eq('status', 'verified')
      .order('matched_at', { ascending: false })
      .limit(LIMIT)
  ])
  if (photos.error) throw photos.error
  if (google.error) throw google.error
  locationIds = [...new Set([...(photos.data || []), ...(google.data || [])].map((row) => row.location_id).filter(Boolean))].slice(0, LIMIT)
}

const result = await syncStaticMediaOverlayForLocations(admin, locationIds)
console.log(JSON.stringify({ mode: 'apply', requested: locationIds.length, ...result }, null, 2))
