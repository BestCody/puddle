import createStyles from "@/components/create-post.module.css"
import { scopedClasses } from "@/components/scoped-classes"
import { AuthMessage } from '@/components/auth-message'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getLocationPlansPage } from '@/lib/app/location-plans-data'
import { getGlobalLocationsByIds } from '@/lib/app/global-location-search'
import { openPhotoUrlForHash } from '@/lib/media/open-photo-url'
import { validCoordinates } from '@/lib/app/optional-number'
import { PostComposer } from './post-composer'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Create a puddle' }

function profilePhotoUrl(session, path) {
  if (!path) return null
  const value = String(path)
  if (value.startsWith('/') || /^https?:\/\//i.test(value)) return value
  return session.supabase.storage.from('puddle-public-media').getPublicUrl(value).data.publicUrl
}

function pointFromGlobalLocation(location) {
  if (!location) return null
  const coordinates = validCoordinates(location.latitude, location.longitude)
  if (!coordinates) return null
  const category = location.category || location.kind || 'location'
  const photoHash = location.primary_photo && typeof location.primary_photo === 'object'
    ? location.primary_photo.content_hash
    : null
  return {
    id: location.id,
    location_id: location.id,
    title: location.name,
    summary: location.summary || location.description || `A ${String(category).replaceAll('_', ' ')} in ${location.neighborhood || location.city || 'your area'}.`,
    category,
    neighborhood: location.neighborhood || null,
    city: location.city || null,
    ...coordinates,
    href: location.slug ? `/plans/${location.slug}` : null,
    photo_url: openPhotoUrlForHash(photoHash),
    states: [],
    match: null,
    plan: null
  }
}

async function requestedSwipePoint(session, requestedLocation) {
  if (!requestedLocation) return null
  const rows = await getGlobalLocationsByIds([requestedLocation], { traceId: session.traceId || null })
  const location = rows?.[0]
  if (!location || location.status !== 'published') return null
  return pointFromGlobalLocation(location)
}

export default async function CreatePostPage({ searchParams }) {
  const params = await searchParams
  return renderProductPage(async (session) => {
    const avatar = profilePhotoUrl(session, session.profile?.avatar_path)
    const name = session.profile?.display_name || 'Puddle person'
    const requestedLocation = typeof params?.location === 'string' ? params.location : null
    const directPoint = await requestedSwipePoint(session, requestedLocation)
    // A Swipe-selected place is sufficient to render the composer. Saved and
    // planned places are only needed if the attach-place menu is opened.
    const savedPage = directPoint ? null : await getLocationPlansPage(session, { tab: 'saved', limit: 1 })
    const saved = savedPage?.items[0]
    const selectedPoint = directPoint || (saved ? { ...saved, photo_url: saved.cover_path } : null)

    return <div className={scopedClasses(createStyles, "figma-create-post-screen")} data-figma-node="25:79">
      <AuthMessage searchParams={params} />
      <PostComposer avatar={avatar} name={name} initialPoint={selectedPoint} />
    </div>
  })
}
