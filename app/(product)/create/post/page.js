import Link from 'next/link'
import { AuthMessage } from '@/components/auth-message'
import { PhotoFrame } from '@/components/photo-frame'
import { RoutedSegment } from '@/components/routed-segment'
import { renderProductPage } from '@/lib/app/render-product-page'
import { getLocationMapSnapshot } from '@/lib/app/location-map-data'
import { getGlobalLocationsByIds } from '@/lib/app/global-location-search'
import { openPhotoUrlForHash } from '@/lib/media/open-photo-url'
import { validCoordinates } from '@/lib/app/optional-number'
import { createPuddlePost } from './actions'
import { PostPlaceChooser } from './post-place-chooser'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Create a puddle' }

function profilePhotoUrl(session, path) {
  if (!path) return null
  const value = String(path)
  if (value.startsWith('/') || /^https?:\/\//i.test(value)) return value
  return session.supabase.storage.from('puddle-public-media').getPublicUrl(value).data.publicUrl
}

function initials(name) {
  return String(name || 'P').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P'
}

function categoryLabel(value) {
  return String(value || 'Park').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
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

function CreatePostPreview({ avatar, name, point }) {
  const title = point?.title || 'Choose a place'
  const category = categoryLabel(point?.category)
  const location = point?.city || point?.neighborhood || 'Your Puddle'
  const copy = point?.summary || 'Pick a place below, add a title and description, then publish it to your feed.'
  return <article className="figma-create-post-blur" aria-hidden="true">
    <PhotoFrame as="span" className="figma-create-post-preview-avatar" src={avatar} alt="" unavailableText={initials(name)} loadingText="" />
    <strong className="figma-create-post-preview-name">{name}</strong>
    <small className="figma-create-post-preview-time">New puddle</small>
    <p className="figma-create-post-preview-copy">{copy}</p>
    <div className="figma-create-post-preview-photos">
      <PhotoFrame as="i" className="is-main" src={point?.photo_url} alt="" unavailableText="Photo unavailable" />
      {point?.photo_url ? <PhotoFrame as="i" src={point.photo_url} alt="" unavailableText="Photo unavailable" /> : <i />}
      <i className="is-more">{point ? 'Place' : '+'}</i>
    </div>
    <div className="figma-create-post-preview-place">
      <span>{category}</span><small>{location}</small><h2>{title}</h2><b>+</b>
    </div>
    <footer className="figma-create-post-preview-actions"><span>◯</span><span>◒</span><span>♡</span><span>↗</span></footer>
  </article>
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
    const snapshot = directPoint ? null : await getLocationMapSnapshot(session)
    const selectedPoint = directPoint || snapshot?.points[0] || null

    return <div className="figma-create-post-screen" data-figma-node="25:79">
      <AuthMessage searchParams={params} />
      <header className="figma-create-post-topbar">
        <Link className="figma-feed-back" href="/map" aria-label="Back to Feed">‹</Link>
        <span className="figma-create-post-mobile-logo" aria-hidden="true" />
        <RoutedSegment
          className="figma-feed-tabs"
          tone="yellow"
          activeValue="feed"
          ariaLabel="Feed or map"
          items={[{ value: 'feed', label: 'Feed', href: '/map' }, { value: 'map', label: 'Map', href: '/map?view=map' }]}
        />
        <form className="figma-feed-search figma-create-post-search" action="/plans" method="get">
          <label><input aria-label="Search saved puddles" type="search" name="q" placeholder="Search saved puddles" /></label>
          <button type="submit" aria-label="Search">⌕</button>
        </form>
      </header>
      <section className="figma-create-post-workspace" aria-label="Post composer preview">
        <CreatePostPreview avatar={avatar} name={name} point={selectedPoint} />
        <form className="figma-create-post-card" aria-label="Create a puddle post" action={createPuddlePost}>
          <input type="hidden" name="location_id" value={selectedPoint?.id || ''} />
          <PhotoFrame as="span" className="figma-feed-post-avatar" src={avatar} alt="" unavailableText={initials(name)} loadingText="" />
          <fieldset className="figma-create-post-visibility" aria-label="Post visibility">
            <label><input type="radio" name="visibility" value="public" defaultChecked /><span>Public</span></label>
            <label><input type="radio" name="visibility" value="friends" /><span>Friends Only</span></label>
          </fieldset>
          <button className="figma-create-post-submit" type="submit" disabled={!selectedPoint} aria-label="Publish post">↑</button>
          <label className="figma-create-post-title"><input aria-label="Title" name="title" maxLength="80" required placeholder="Title" /></label>
          <label className="figma-create-post-description"><textarea aria-label="Description" name="description" maxLength="1000" placeholder="Description" /></label>
          <PostPlaceChooser key={selectedPoint?.id || 'none'} selectedPoint={selectedPoint} initialPoints={snapshot?.points ?? null} />
          <Link className="figma-create-post-map" href="/map?view=map&selectForPost=1" aria-label="Choose a place from the map">⌑</Link>
        </form>
      </section>
      {!selectedPoint ? <div className="figma-create-post-empty"><strong>Choose a place before you post.</strong><Link href="/discover">Start swiping</Link></div> : null}
    </div>
  })
}
