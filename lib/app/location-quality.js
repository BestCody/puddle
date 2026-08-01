const HUMAN_DESCRIPTION_SOURCES = new Set(['venue', 'editorial', 'community', 'wikipedia'])

function clamp(value, min = 0, max = 1) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return min
  return Math.max(min, Math.min(max, parsed))
}

function cleanText(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function label(value) {
  return cleanText(value || 'place', 80).replaceAll('_', ' ').replaceAll('-', ' ')
}

export function buildFactualLocationDescription(candidate = {}) {
  const existing = cleanText(candidate.description || candidate.summary, 500)
  if (existing) return existing

  const category = label(candidate.category || candidate.kind)
  const area = cleanText(candidate.neighborhood || candidate.neighbourhood || candidate.city, 100)
  const parts = [`A ${category}${area ? ` in ${area}` : ''}.`]
  const amenities = (Array.isArray(candidate.amenities) ? candidate.amenities : [])
    .map((item) => label(item))
    .filter(Boolean)
    .slice(0, 3)
  if (amenities.length) parts.push(`Listed features include ${amenities.join(', ')}.`)
  if (candidate.price_level) parts.push(`The listed price level is ${'$'.repeat(Math.max(1, Math.min(4, Number(candidate.price_level))))}.`)
  if (!candidate.opening_hours || !Object.keys(candidate.opening_hours).length) parts.push('Opening hours have not yet been verified.')
  return parts.join(' ')
}

export function normalizeRatingSummary(summary = {}) {
  const count = Math.max(0, Number(summary.rating_count || summary.ratingCount || 0))
  const rawAverage = Number(summary.average_rating || summary.averageRating)
  const adjusted = Number(summary.confidence_adjusted_rating || summary.confidenceAdjustedRating)
  const average = Number.isFinite(rawAverage) ? clamp((rawAverage - 1) / 4) : null
  const confidenceAdjusted = Number.isFinite(adjusted) ? clamp((adjusted - 1) / 4) : 0.7
  return {
    ratingCount: count,
    averageRating: average === null ? null : Math.round((average * 4 + 1) * 10) / 10,
    ratingScore: Math.round(confidenceAdjusted * 10000) / 10000,
    confidenceAdjustedRating: Math.round((confidenceAdjusted * 4 + 1) * 100) / 100
  }
}

export function evaluateLocationCardQuality(candidate = {}, options = {}) {
  const description = cleanText(options.description || candidate.description || candidate.summary || buildFactualLocationDescription(candidate), 500)
  const descriptionSource = cleanText(options.descriptionSource || candidate.description_source || candidate.descriptionSource || (candidate.summary ? 'location_summary' : 'generated_factual'), 40)
  const hasRealPhoto = Boolean(options.hasRealPhoto ?? candidate.has_real_photo ?? candidate.cover_path)
  const humanDescription = HUMAN_DESCRIPTION_SOURCES.has(descriptionSource)
  let cardTier = 0
  if (hasRealPhoto && description) cardTier = humanDescription ? 3 : 2
  else if (description) cardTier = 1

  const descriptionQuality = description ? (humanDescription ? 1 : descriptionSource === 'location_summary' ? 0.85 : 0.7) : 0
  const imageQuality = hasRealPhoto ? clamp(options.photoConfidence ?? candidate.photo_match_confidence ?? 1) : 0
  const contentQualityScore = Math.round((imageQuality * 0.65 + descriptionQuality * 0.35) * 10000) / 10000

  return {
    description,
    descriptionSource,
    hasRealPhoto,
    cardTier,
    contentQualityScore,
    humanDescription,
    recommendationReady: cardTier >= 2,
    fallbackCard: cardTier === 1
  }
}

export function composeLocationRankingScore({ cardTier = 0, ratingScore = 0.7, relevanceScore = 0 }) {
  const tier = Math.max(0, Math.min(3, Math.trunc(Number(cardTier) || 0)))
  const rating = clamp(ratingScore)
  const relevance = Math.max(-499, Math.min(499, Number(relevanceScore) || 0))
  return Math.round((tier * 1_000_000 + rating * 10_000 + relevance) * 10000) / 10000
}

export function compareLocationCandidates(a, b) {
  return Number(b.card_tier || 0) - Number(a.card_tier || 0)
    || Number(b.rating_score || 0) - Number(a.rating_score || 0)
    || Number(b.relevance_score || 0) - Number(a.relevance_score || 0)
    || Number(b.content_quality_score || 0) - Number(a.content_quality_score || 0)
    || String(a.title || '').localeCompare(String(b.title || ''))
}

export function ratingLabel(candidate = {}) {
  const count = Number(candidate.rating_count || 0)
  const adjusted = Number(candidate.confidence_adjusted_rating)
  if (!count || !Number.isFinite(adjusted)) return 'New on Puddle'
  return `${adjusted.toFixed(1)} · ${count} ${count === 1 ? 'rating' : 'ratings'}`
}
