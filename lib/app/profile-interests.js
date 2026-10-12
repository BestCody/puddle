export const PROFILE_INTEREST_OPTIONS = [
  { value: 'cafe', label: 'Coffee shops', detail: 'Coffee, tea, and easy conversation' },
  { value: 'restaurant', label: 'Restaurants', detail: 'Dinner, brunch, and tasting spots' },
  { value: 'bar', label: 'Bars & lounges', detail: 'Cocktails, mocktails, and late-night drinks' },
  { value: 'park', label: 'Parks & gardens', detail: 'Walks, picnics, and fresh air' },
  { value: 'museum', label: 'Museums', detail: 'Something interesting to explore together' },
  { value: 'gallery', label: 'Galleries', detail: 'Art, exhibits, and conversation starters' },
  { value: 'attraction', label: 'Local attractions', detail: 'Landmarks, aquariums, and city favourites' },
  { value: 'activity_venue', label: 'Activity dates', detail: 'Arcades, bowling, mini golf, and more' },
  { value: 'scenic_spot', label: 'Scenic spots', detail: 'Views, sunsets, and photo-worthy places' },
  { value: 'nightlife', label: 'Nightlife', detail: 'Dancing, live energy, and nights out' },
  { value: 'shop', label: 'Markets & bookstores', detail: 'Browse, wander, and discover something new' },
  { value: 'community_space', label: 'Community spaces', detail: 'Low-key local gems and shared experiences' }
]

const allowed = new Set(PROFILE_INTEREST_OPTIONS.map(option => option.value))

export function normalizeProfileInterests(values) {
  return [...new Set(values.map(String).filter(value => allowed.has(value)))].slice(0, PROFILE_INTEREST_OPTIONS.length)
}
