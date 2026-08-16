import { unstable_cache } from 'next/cache'
import { createPublicClient } from '@/lib/supabase/public'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { demoEvent, demoPlace } from './public-content'

async function queryOne(query) {
  const { data, error } = await query
  if (error) throw error
  return data
}

async function queryMany(query) {
  const { data, error } = await query
  if (error) throw error
  return data || []
}

function publicUrl(supabase, path) {
  if (!path) return null
  if (String(path).startsWith('/')) return path
  return supabase.storage.from('puddle-public-media').getPublicUrl(path).data.publicUrl
}

async function galleryFor(supabase, locationId) {
  const rows = await queryMany(
    supabase
      .from('location_media')
      .select('sort_order,caption,media_assets!inner(id,object_path,status,visibility)')
      .eq('location_id', locationId)
      .order('sort_order')
  )
  return rows
    .filter((row) => row.media_assets?.status === 'approved' && row.media_assets?.visibility === 'public')
    .map((row) => ({
      id: row.media_assets.id,
      url: publicUrl(supabase, row.media_assets.object_path),
      caption: row.caption
    }))
}

function withCardMedia(supabase, item) {
  return { ...item, cover_url: publicUrl(supabase, item.cover_path) }
}

async function loadPublicLocation(slug) {
  if (!isSupabaseConfigured()) return slug === demoPlace.slug ? { location: demoPlace, similar: [demoEvent] } : null

  const supabase = createPublicClient()
  const location = await queryOne(
    supabase.from('locations').select('*').eq('slug', slug).eq('status', 'published').maybeSingle()
  )
  if (!location) return null

  const [host, gallery, similarPlaces, events] = await Promise.all([
    location.host_profile_id
      ? queryOne(supabase.from('host_profiles').select('*').eq('id', location.host_profile_id).maybeSingle())
      : null,
    galleryFor(supabase, location.id),
    queryMany(
      supabase
        .from('locations')
        .select('id,slug,name,summary,kind,city,price_level,cover_path')
        .eq('status', 'published')
        .eq('kind', location.kind)
        .neq('id', location.id)
        .limit(3)
    ),
    queryMany(
      supabase
        .from('events')
        .select('id,slug,title,summary,category,starts_at,price_from_cents,currency,cover_path')
        .eq('status', 'published')
        .eq('location_id', location.id)
        .limit(3)
    )
  ])

  const enriched = {
    ...location,
    cover_url: publicUrl(supabase, location.cover_path),
    gallery,
    host: host ? { ...host, logo_url: publicUrl(supabase, host.logo_path) } : null
  }

  return {
    location: enriched,
    similar: [
      ...events.map((item) => ({ ...withCardMedia(supabase, item), content_kind: 'event' })),
      ...similarPlaces.map((item) => ({ ...withCardMedia(supabase, item), content_kind: 'place' }))
    ]
  }
}

export const getCachedPublicLocation = unstable_cache(
  loadPublicLocation,
  ['public-location-v1'],
  { revalidate: 300, tags: ['public-locations'] }
)
