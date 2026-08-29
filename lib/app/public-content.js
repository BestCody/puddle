import { getCachedPublicLocation, getCachedPublicLocationRecommendations } from './public-location-cache'

export async function getPublicLocation(slug) {
  return getCachedPublicLocation(slug)
}

export async function getPublicLocationRecommendations(slug) {
  return getCachedPublicLocationRecommendations(slug)
}

export function placeStructuredData(location, url) {
  return { '@context': 'https://schema.org', '@type': 'Place', name: location.name, description: location.summary || location.description, image: location.cover_url ? [location.cover_url, ...(location.gallery || []).map((item)=>item.url)] : undefined, url, address: location.address_public || undefined, geo: location.latitude && location.longitude ? { '@type':'GeoCoordinates', latitude:location.latitude, longitude:location.longitude } : undefined, amenityFeature: (location.amenities || []).map((name) => ({ '@type': 'LocationFeatureSpecification', name, value: true })) }
}

export function breadcrumbStructuredData(trail, site) {
  const items = trail.filter((crumb) => crumb.href)
  if (items.length < 2) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.label,
      item: `${site}${crumb.href}`
    }))
  }
}

export function placeListStructuredData(places, site, name) {
  if (!places.length) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: places.length,
    itemListElement: places.map((place, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: `${site}/places/${encodeURIComponent(place.slug)}`,
      name: place.name
    }))
  }
}

export function siteOrigin() {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://puddle.you').replace(/\/$/, '')
}
