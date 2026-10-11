// Deterministic presentation data only. No real credentials, network or storage.
export const photo = '/figma/assets/safety-toronto.webp'
export const person = { id: '00000000-0000-4000-8000-000000000001', display_name: 'Alex Puddle', username: 'alexpuddle', avatar_path: '/figma/assets/logo.svg', appearance_theme: 'light', profile_theme: 'blue', interests: ['park', 'cafe'], city: 'Oakville', country: 'Canada' }
export const places = Array.from({ length: 12 }, (_, i) => ({ id: `visual-place-${i}`, location_id: `visual-place-${i}`, name: i % 2 ? 'Lakeside Cafe' : 'Maple Grove Park', title: i % 2 ? 'Lakeside Cafe' : 'Maple Grove Park', slug: `visual-place-${i}`, status: 'published', kind: 'park', category: 'park', city: 'Oakville', latitude: 43.45, longitude: -79.66, cover_path: photo, photo_url: photo, address_public: '2243 Devon Road, Oakville', distance_label: '208m' }))
export const posts = places.slice(0, 3).map((place, i) => ({ id: `post-${i}`, location_id: place.id, title: 'An afternoon outdoors', body: 'A lovely place to explore with friends.', created_at: '2026-10-10T12:00:00Z', author: person, author_avatar_url: person.avatar_path, location: place, photo_urls: [photo], comments: [], saved: false }))
export const conversations = [{ conversation_id: '00000000-0000-4000-8000-000000000003', friend_id: '00000000-0000-4000-8000-000000000002', display_name: 'Jamie', username: 'jamie', avatar_path: person.avatar_path, last_message: 'See you at the park!', last_message_at: '2026-10-10T12:00:00Z', unread_count: 2 }, { conversation_id: '00000000-0000-4000-8000-000000000004', friend_id: '00000000-0000-4000-8000-000000000005', display_name: 'Taylor', username: 'taylor', avatar_path: person.avatar_path, last_message: 'Taylor conversation', last_message_at: '2026-10-10T12:01:00Z', unread_count: 0 }]
export const messages = [{ id: 'message-1', sender_id: conversations[0].friend_id, message_body: 'See you at the park!', body: 'See you at the park!', created_at: '2026-10-10T12:00:00Z' }, { id: 'message-2', sender_id: person.id, message_body: 'Sounds good! See you there.', body: 'Sounds good! See you there.', created_at: '2026-10-10T12:01:00Z' }]
export const snapshot = { self: person, friends: [{ ...person, id: conversations[0].friend_id, display_name: 'Jamie' }], requests: [], conversations, selectedConversation: conversations[0], messages, shared: [], shareableLocations: places.slice(0, 3), passActive: false }
export function messagesForConversation(id) {
  return id === conversations[1].conversation_id ? [{ id: 'taylor-message', sender_id: conversations[1].friend_id, body: 'Taylor conversation', created_at: '2026-10-10T12:01:00Z' }] : messages
}
export function snapshotForConversation(id) {
  const selectedConversation = conversations.find(item => item.conversation_id === id) || conversations[0]
  return { ...snapshot, selectedConversation, messages: messagesForConversation(selectedConversation.conversation_id), messagesHasMore: selectedConversation === conversations[0] }
}
const tables = { social_posts: posts, user_content_states: places.map(p => ({ location_id: p.id, created_at: '2026-10-10T12:00:00Z' })), notifications: [], notification_preferences: [null], profiles: [person] }
const rpcs = { social_friend_count_v1: 1, social_friends_v2: snapshot.friends, puddle_tinder_active_v1: false, social_messages_v2: messages, social_conversations_v2: conversations, social_mark_conversation_read_v1: null }
function query(data, count = Array.isArray(data) ? data.length : 0) {
  const q = { then: (resolve, reject) => Promise.resolve({ data, count, error: null }).then(resolve, reject), maybeSingle: () => Promise.resolve({ data: data?.[0] ?? null, error: null }), single: () => Promise.resolve({ data: data?.[0] ?? null, error: null }) }
  for (const name of ['select', 'eq', 'not', 'is', 'order', 'limit', 'in']) q[name] = () => q
  return q
}
const client = {
  from(name) { if (!(name in tables)) throw new Error(`Unmodelled visual fixture table: ${name}`); return query(tables[name]) },
  rpc(name, args = {}) {
    if (name === 'social_messages_v2') return fetch(`/api/fixture/messages?conversation=${encodeURIComponent(args.target)}&before=${encodeURIComponent(args.before_message_id || '')}`).then(response => response.json())
    if (!(name in rpcs)) throw new Error(`Unmodelled visual fixture RPC: ${name}`)
    return Promise.resolve({ data: rpcs[name], error: null })
  },
  storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: photo } }) }) },
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel },
  removeChannel: () => Promise.resolve()
}
export function createClient() { return client }
export async function requireUser() { return { user: { ...person, email: 'visual@example.test', aud: 'authenticated' }, profile: person, supabase: client } }
export async function getGlobalLocationsByIds(ids) { return places.filter(p => ids.includes(p.id)) }
export async function getMembershipSnapshot() { return { active: false, adult: true, paymentsConfigured: false, membership: null } }
export function ageFromBirthDate() { return 25 }
export async function getLocationPlansPage() { return { items: places, pagination: { hasMore: false } } }
export async function getSavedCategories() { return [{ category: 'park', place_count: 12 }] }
export const mapPoints = places.map(place => ({ ...place, states: ['saved'], href: `/plans/${place.slug}`, summary: 'A quiet green space to explore with friends.' }))
export async function getLocationMapSnapshot() { return { points: mapPoints, center: { latitude: 43.45, longitude: -79.66 } } }
