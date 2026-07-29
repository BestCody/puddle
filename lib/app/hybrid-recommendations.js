const SIGNAL_CAPS = Object.freeze({
  explicitInterest: 24,
  behavioralAffinity: 20,
  negativeAffinity: 14,
  vectorSimilarity: 20,
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

  const components = {}
  const explicit = hasInterest(context?.explicitInterests, category) ? 1 : 0
  components.explicitInterest = weight('explicitInterest', explicit, context)

  const positive = clamp(categoryValue(context?.positiveCategories, category) / 25)
  components.behavioralAffinity = behavioralEnabled ? weight('behavioralAffinity', positive, context) : 0

  const negative = clamp(categoryValue(context?.negativeCategories, category) / 12)
  components.negativeAffinity = behavioralEnabled ? -weight('negativeAffinity', negative, context) : 0

  const vector = clamp(candidate.vector_similarity)
  const vectorMultiplier = experiment.variant === 'vector_boost' ? 1.2 : 1
  components.vectorSimilarity = vectorEnabled ? weight('vectorSimilarity', vector, context, vectorMultiplier) : 0

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
    .map(([name]) => EXPLANATIONS[name](candidate))

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

export const HYBRID_RANKING_VERSION = 'hybrid-v1'
export const RULES_FALLBACK_VERSION = 'rules-v2-fallback'
