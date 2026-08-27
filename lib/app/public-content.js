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
