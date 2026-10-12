import { person, places, posts, photo, mapPoints, messagesForConversation } from '../../../mocks/data'

export async function GET(request, { params }) {
  const { api } = await params
  const route = api.join('/')
  if (route === 'fixture/messages') return Response.json({ data: messagesForConversation(new URL(request.url).searchParams.get('conversation')), error: null })
  if (route === 'fixture/reviews') return Response.json({ data: [], error: null })
  if (route === 'fixture/friends') return Response.json({ data: [person], error: null })
  if (route === 'profile/identity') return Response.json({ avatarUrl: person.avatar_path, displayName: person.display_name, appearanceTheme: 'dark' })
  if (route === 'social-feed') return Response.json({ items: posts, pagination: { hasMore: false }, self: person })
  if (route === 'saved-page') {
    const params = new URL(request.url).searchParams
    const q = (params.get('q') || '').toLowerCase()
    const all = Array.from({ length: 106 }, (_, index) => ({ ...places[index % places.length], id: `picker-place-${index}`, location_id: `picker-place-${index}`, title: index === 105 ? 'Last saved place' : `Saved place ${index + 1}` })).filter(item => item.title.toLowerCase().includes(q))
    const start = Number(params.get('cursor') || 0)
    return Response.json({ items: all.slice(start, start + 24), pagination: { hasMore: start + 24 < all.length, nextCursor: String(start + 24) } })
  }
  if (route.startsWith('saved-location/')) return Response.json({ location: { ...places[0], cover_url: photo, summary: 'A peaceful green space to explore together.' }, state: { saved: true }, posts, similar: [] })
  if (route.endsWith('/similar')) return Response.json({ items: [] })
  if (route === 'map/snapshot') return Response.json({ points: mapPoints, center: { latitude: 43.45, longitude: -79.66 } })
  if (route === 'map/viewport') return Response.json({ points: mapPoints })
  if (route === 'map/heatmap') return Response.json({ cells: [] })
  return Response.json({ error: `Unmodelled visual fixture request: ${route}` }, { status: 404 })
}

// Mutations deliberately cannot reach application APIs from this test app.
export async function POST() { return Response.json({ error: 'Visual fixture is read-only' }, { status: 405 }) }
