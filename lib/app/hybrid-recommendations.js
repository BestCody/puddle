const SIGNAL_CAPS = Object.freeze({
  explicitInterest: 24,
  behavioralAffinity: 20,
  negativeAffinity: 14,
  vectorSimilarity: 20,
  contextualCategory: 12,
  contextualPrice: 7,
  contextualAmenities: 7,
  contextualDistance: 5,
  proximity: 16,
  timeRelevance: 14,
  openingHours: 9,
  followedHost: 11,
  friendActivity: 8,
  popularity: 7,
  freshness: 6,
  novelty: 6,
  availability: 4,
  queryMatch: 7,
  verifiedHost: 3,
  exploration: 3
})

const EXPLANATIONS = Object.freeze({
  explicitInterest: ({ category }) => `Matches your interest in ${label(category)}`,
  behavioralAffinity: ({ category }) => `Similar to ${label(category)} plans you liked`,
  vectorSimilarity: ({ content_kind }) => content_kind === 'event' ? 'Similar to events you engaged with' : 'Similar to places you engaged with',
  contextualCategory: (_, detail) => detail?.label || 'Fits the kinds of places you tend to save in this context',
  contextualPrice: (_, detail) => detail?.label || 'Fits the price range you tend to choose',
  contextualAmenities: (_, detail) => detail?.label || 'Includes amenities you tend to choose',
  contextualDistance: (_, detail) => detail?.label || 'Fits how far you usually go for plans like this',
  proximity: () => 'Near you',
  timeRelevance: () => 'Happening soon',
  openingHours: () => 'Open now',
  followedHost: () => 'From a host you follow',
  friendActivity: () => 'Popular with friends who share activity',
  popularity: () => 'Popular on Puddle',
  freshness: () => 'Recently added',
  novelty: () => 'Something different from your recent picks',
  availability: () => 'Space is available',
  queryMatch: () => 'Matches your search',
  verifiedHost: () => 'Verified host',
  exploration: () => 'An exploratory pick'
})

function clamp(value, min = 0, max = 1) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.max(min, Math.min(max, number))
}

function label(value) {
  return String(value || 'this category').replaceAll('_', ' ').replaceAll('-', ' ')
}

function token(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 60)
}

function stableUnit(value) {
  let hash = 2166136261
  for (const character of String(value || '')) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

function categoryValue(map, category) {
  if (!map || typeof map !== 'object') return 0
  return Number(map[category] || map[String(category || '').replaceAll('-', '_')] || 0)
}

function hasInterest(interests, category) {
  const normalized = label(category).toLowerCase()
  return (Array.isArray(interests) ? interests : []).some((interest) => {
    const value = label(interest).toLowerCase()
    return value === normalized || value.includes(normalized) || normalized.includes(value)
  })
}

function distanceSignal(distance, radiusMeters) {
  if (!Number.isFinite(Number(distance))) return 0
  const radius = Math.max(1000, Number(radiusMeters) || 25000)
  return 1 - clamp(Number(distance) / radius)
}

function timeSignal(candidate, now) {
  if (candidate.content_kind !== 'event' || !candidate.starts_at) return 0
  const hours = (new Date(candidate.starts_at).getTime() - now.getTime()) / 3_600_000
  if (!Number.isFinite(hours) || hours < -3) return 0
  if (hours <= 12) return 1
  if (hours <= 24) return 0.9
  if (hours <= 72) return 0.7
  if (hours <= 168) return 0.45
  if (hours <= 720) return 0.2
  return 0.05
}

function freshnessSignal(value, now) {
  if (!value) return 0
  const days = Math.max(0, (now.getTime() - new Date(value).getTime()) / 86_400_000)
  if (!Number.isFinite(days)) return 0
  return Math.exp(-days / 21)
}

function targetKey(candidate) {
  return `${candidate.content_kind}:${candidate.content_id}`
}

function weight(name, normalized, context, multiplier = 1) {
  const hardCap = SIGNAL_CAPS[name] || 0
  const configured = Number(context?.rankingConfig?.weights?.[name])
  const points = Number.isFinite(configured) ? clamp(configured, 0, hardCap) : hardCap
  return Math.min(hardCap, Math.max(0, normalized) * points * multiplier)
}

function signedWeight(name, affinity, context) {
  const value = clamp(Math.abs(Number(affinity) || 0))
  if (!value) return 0
  return Math.sign(affinity) * weight(name, value, context)
}

function localTimeContext(candidate, now) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: candidate?.timezone || 'UTC',
      weekday: 'short',
      hour: '2-digit',
      hour12: false
    })
    const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]))
    const hour = Number(parts.hour) % 24
    const daypart = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 22 ? 'evening' : 'late_night'
    const dayType = ['Sat', 'Sun'].includes(parts.weekday) ? 'weekend' : 'weekday'
    return { daypart, dayType }
  } catch {
    const hour = now.getUTCHours()
    return {
      daypart: hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 22 ? 'evening' : 'late_night',
      dayType: [0, 6].includes(now.getUTCDay()) ? 'weekend' : 'weekday'
    }
  }
}

export function recommendationIntentBucket(filters = {}) {
  const query = `${filters.q || ''} ${filters.category || ''} ${filters.amenity || ''}`.toLowerCase()
  if (/coffee|cafe|espresso|tea|brunch|bakery/.test(query)) return 'coffee'
  if (/drink|cocktail|bar|pub|beer|wine|lounge/.test(query)) return 'drinks'
  if (/dinner|lunch|food|restaurant|meal|sushi|pizza|dessert/.test(query)) return 'meal'
  if (/park|walk|hike|trail|outdoor|sunset|scenic|garden|waterfront/.test(query)) return 'outdoors'
  if (/museum|gallery|art|culture|exhibit|theatre|theater/.test(query)) return 'culture'
  if (/activity|bowling|arcade|game|climb|skate|mini.?golf/.test(query)) return 'activity'
  if (/quiet|study|read|work|cozy|low.?key/.test(query)) return 'quiet'
  if (/romantic|date|anniversary|special/.test(query)) return 'romantic'
  if (/casual|hangout|chill|friends/.test(query)) return 'casual'
  const category = token(filters.category)
  if (category) return category
  if (filters.openNow || filters.open_now) return 'open_now'
  if (filters.accessible) return 'accessible'
  return null
}

function contextKeys(value, context) {
  const normalized = token(value)
  if (!normalized) return []
  const keys = [{ key: `global|${normalized}`, weight: 0.35, label: 'Fits places you tend to save' }]
  if (context.daypart) keys.push({ key: `daypart:${context.daypart}|${normalized}`, weight: 0.75, label: `Fits your ${label(context.daypart)} picks` })
  if (context.dayType) keys.push({ key: `daytype:${context.dayType}|${normalized}`, weight: 0.55, label: `Fits your ${label(context.dayType)} picks` })
  if (context.intent) keys.push({ key: `intent:${context.intent}|${normalized}`, weight: 1, label: `Fits your ${label(context.intent)} plans` })
  return keys
}

function contextualAffinity(map, value, context) {
  if (!map || typeof map !== 'object') return { value: 0, label: null }
  const matches = contextKeys(value, context)
    .map((entry) => ({ ...entry, value: Number(map[entry.key]) }))
    .filter((entry) => Number.isFinite(entry.value))
  if (!matches.length) return { value: 0, label: null }
  const totalWeight = matches.reduce((sum, entry) => sum + entry.weight, 0)
  const valueSum = matches.reduce((sum, entry) => sum + entry.value * entry.weight, 0)
  const strongest = [...matches].sort((a, b) => Math.abs(b.value * b.weight) - Math.abs(a.value * a.weight))[0]
  return { value: clamp(valueSum / Math.max(totalWeight, 0.0001), -1, 1), label: strongest?.label || null }
}

function contextualDistance(contextMap, candidateDistance, context) {
  if (!contextMap || typeof contextMap !== 'object' || !Number.isFinite(Number(candidateDistance))) return { value: 0, label: null }
  const distanceKm = Number(candidateDistance) / 1000
  const matches = contextKeys('distance', context)
    .map((entry) => ({ ...entry, value: Number(contextMap[entry.key]) }))
    .filter((entry) => Number.isFinite(entry.value) && entry.value > 0)
  if (!matches.length) return { value: 0, label: null }
  const totalWeight = matches.reduce((sum, entry) => sum + entry.weight, 0)
  const preferredKm = matches.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / Math.max(totalWeight, 0.0001)
  const tolerance = Math.max(3, preferredKm)
  const similarity = 1 - clamp(Math.abs(distanceKm - preferredKm) / tolerance)
  const strongest = [...matches].sort((a, b) => b.weight - a.weight)[0]
  return { value: similarity, label: strongest?.label?.replace('Fits ', 'Fits how far you go for ') || null }
}

export function scoreHybridCandidate(candidate, context, options = {}) {
  const now = options.now || new Date()
  const filters = options.filters || {}
  const experiment = options.experiment || { variant: 'control', holdout: false }
  const preferences = context?.preferences || {}
  const explicitOnly = Boolean(preferences.explicit_interests_only ?? preferences.explicitInterestsOnly)
  const behavioralEnabled = Boolean(preferences.behavioral_enabled ?? preferences.behavioralEnabled ?? true) && !explicitOnly && context?.featureFlags?.behavioral !== false
  const friendEnabled = Boolean(preferences.friend_activity_enabled ?? preferences.friendActivityEnabled ?? true)
  const vectorEnabled = !experiment.holdout && experiment.variant !== 'rules_holdout' && Boolean(preferences.vector_enabled ?? preferences.vectorEnabled ?? true) && context?.featureFlags?.vector !== false
  const category = String(candidate.category || '')
  const recentTargets = new Set(Array.isArray(context?.recentTargets) ? context.recentTargets : [])
  const followedHosts = new Set((Array.isArray(context?.followedHosts) ? context.followedHosts : []).map(String))
  const timeContext = localTimeContext(candidate, now)
  const recommendationContext = { ...timeContext, intent: recommendationIntentBucket(filters) }
  const contextualConfidence = behavioralEnabled ? clamp(context?.contextualConfidence) : 0

  const components = {}
  const details = {}
  const explicit = hasInterest(context?.explicitInterests, category) ? 1 : 0
  components.explicitInterest = weight('explicitInterest', explicit, context)

  const positive = clamp(categoryValue(context?.positiveCategories, category) / 25)
  components.behavioralAffinity = behavioralEnabled ? weight('behavioralAffinity', positive, context) : 0

  const negative = clamp(categoryValue(context?.negativeCategories, category) / 12)
  components.negativeAffinity = behavioralEnabled ? -weight('negativeAffinity', negative, context) : 0

  const vector = clamp(candidate.vector_similarity)
  const vectorMultiplier = experiment.variant === 'vector_boost' ? 1.2 : 1
  components.vectorSimilarity = vectorEnabled ? weight('vectorSimilarity', vector, context, vectorMultiplier) : 0

  const categoryAffinity = contextualAffinity(context?.contextualCategory, category, recommendationContext)
  components.contextualCategory = contextualConfidence ? signedWeight('contextualCategory', categoryAffinity.value * contextualConfidence, context) : 0
  details.contextualCategory = categoryAffinity

  const priceAffinity = contextualAffinity(context?.contextualPrice, candidate.price_level, recommendationContext)
  components.contextualPrice = contextualConfidence ? signedWeight('contextualPrice', priceAffinity.value * contextualConfidence, context) : 0
  details.contextualPrice = priceAffinity

  const amenityAffinities = (Array.isArray(candidate.amenities) ? candidate.amenities : [])
    .map((amenity) => contextualAffinity(context?.contextualAmenities, amenity, recommendationContext))
    .filter((entry) => entry.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 2)
  const amenityAffinity = amenityAffinities.length ? amenityAffinities.reduce((sum, entry) => sum + entry.value, 0) / amenityAffinities.length : 0
  components.contextualAmenities = contextualConfidence ? signedWeight('contextualAmenities', amenityAffinity * contextualConfidence, context) : 0
  details.contextualAmenities = amenityAffinities[0] || { value: 0, label: null }

  const learnedDistance = contextualDistance(context?.contextualDistanceKm, candidate.distance_m, recommendationContext)
  components.contextualDistance = contextualConfidence ? weight('contextualDistance', learnedDistance.value * contextualConfidence, context) : 0
  details.contextualDistance = learnedDistance

  components.proximity = weight('proximity', distanceSignal(candidate.distance_m, Number(filters.distance || 25) * 1000), context)
  components.timeRelevance = weight('timeRelevance', timeSignal(candidate, now), context)
  components.openingHours = candidate.content_kind === 'place' && candidate.open_now ? weight('openingHours', 1, context) : 0
  components.followedHost = candidate.host_id && followedHosts.has(String(candidate.host_id)) ? weight('followedHost', 1, context) : 0
  components.friendActivity = friendEnabled ? weight('friendActivity', clamp(candidate.friend_score), context) : 0
  components.popularity = weight('popularity', clamp(candidate.popularity_score), context)
  components.freshness = weight('freshness', freshnessSignal(candidate.published_at, now), context)
  components.novelty = recentTargets.has(targetKey(candidate)) ? 0 : weight('novelty', 1, context)
  components.availability = candidate.content_kind === 'event' && (candidate.remaining_capacity === null || Number(candidate.remaining_capacity) > 0) ? weight('availability', 1, context) : 0
  components.queryMatch = filters.q ? weight('queryMatch', 1, context) : 0
  components.verifiedHost = candidate.host_verified ? weight('verifiedHost', 1, context) : 0
  components.exploration = weight('exploration', stableUnit(`${options.requestId}:${targetKey(candidate)}`), context)

  const finalScore = Object.values(components).reduce((sum, value) => sum + value, 0)
  const explanations = Object.entries(components)
    .filter(([name, value]) => value > 0 && EXPLANATIONS[name])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => EXPLANATIONS[name](candidate, details[name]))

  const sources = new Set(Array.isArray(candidate.candidate_sources) ? candidate.candidate_sources.filter(Boolean) : [])
  for (const [name, value] of Object.entries(components)) if (value > 0) sources.add(name)

  return {
    finalScore: Math.round(finalScore * 10000) / 10000,
    components,
    explanations,
    candidateSources: [...sources],
    vectorSimilarity: vectorEnabled && Number.isFinite(Number(candidate.vector_similarity)) ? Number(candidate.vector_similarity) : null
  }
}

export function diversifyRecommendations(items, limit, configuration = {}) {
  const remaining = [...items]
  const result = []
  const hostCounts = new Map()
  const categoryCounts = new Map()
  const kindCounts = new Map()

  while (remaining.length && result.length < limit) {
    let bestIndex = 0
    let bestAdjusted = -Infinity
    for (let index = 0; index < remaining.length; index += 1) {
      const item = remaining[index]
      const hostCount = item.host_id ? hostCounts.get(item.host_id) || 0 : 0
      const categoryCount = categoryCounts.get(item.category) || 0
      const kindCount = kindCounts.get(item.content_kind) || 0
      const recent = result.slice(-5)
      const hostPenalty = clamp(configuration.hostPenalty, 0, 12) || 4
      const categoryPenalty = clamp(configuration.categoryPenalty, 0, 12) || 3
      const kindPenalty = clamp(configuration.kindPenalty, 0, 8) || 2
      const immediateCategoryPenalty = clamp(configuration.immediateCategoryPenalty, 0, 12) || 4
      const repetitionPenalty = hostCount * hostPenalty + categoryCount * categoryPenalty + Math.max(0, kindCount - result.length / 2) * kindPenalty
      const immediatePenalty = recent.some((entry) => entry.category === item.category) ? immediateCategoryPenalty : 0
      const adjusted = item.score - repetitionPenalty - immediatePenalty
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted
        bestIndex = index
      }
    }
    const [selected] = remaining.splice(bestIndex, 1)
    result.push(selected)
    if (selected.host_id) hostCounts.set(selected.host_id, (hostCounts.get(selected.host_id) || 0) + 1)
    categoryCounts.set(selected.category, (categoryCounts.get(selected.category) || 0) + 1)
    kindCounts.set(selected.content_kind, (kindCounts.get(selected.content_kind) || 0) + 1)
  }
  return result
}

export const HYBRID_RANKING_VERSION = 'contextual-v2'
export const RULES_FALLBACK_VERSION = 'rules-v2-fallback'
