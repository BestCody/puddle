import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildFactualLocationDescription,
  compareLocationCandidates,
  composeLocationRankingScore,
  evaluateLocationCardQuality,
  normalizeRatingSummary,
  ratingLabel
} from '../../lib/app/location-quality.js'

test('builds a factual description without subjective claims', () => {
  const description = buildFactualLocationDescription({
    category: 'activity_venue',
    neighborhood: 'Kensington Market',
    amenities: ['wheelchair_accessible', 'indoor'],
    price_level: 2,
    opening_hours: {}
  })
  assert.match(description, /activity venue in Kensington Market/i)
  assert.match(description, /Opening hours have not yet been verified/i)
  assert.doesNotMatch(description, /romantic|cozy|perfect/i)
})

test('real photo and description create a higher card tier', () => {
  const premium = evaluateLocationCardQuality({}, {
    description: 'A verified venue description with useful factual details.',
    descriptionSource: 'venue',
    hasRealPhoto: true
  })
  const standard = evaluateLocationCardQuality({}, {
    description: 'A generated factual description with enough useful detail.',
    descriptionSource: 'generated_factual',
    hasRealPhoto: true
  })
  const fallback = evaluateLocationCardQuality({}, {
    description: 'A generated factual description with enough useful detail.',
    descriptionSource: 'generated_factual',
    hasRealPhoto: false
  })
  assert.equal(premium.cardTier, 3)
  assert.equal(standard.cardTier, 2)
  assert.equal(fallback.cardTier, 1)
  assert.equal(premium.recommendationReady, true)
  assert.equal(fallback.fallbackCard, true)
})

test('new locations receive a neutral Bayesian rating prior', () => {
  const rating = normalizeRatingSummary({ rating_count: 0, confidence_adjusted_rating: 3.8 })
  assert.equal(rating.ratingCount, 0)
  assert.equal(rating.confidenceAdjustedRating, 3.8)
  assert.equal(ratingLabel({ rating_count: 0 }), 'New on Puddle')
})

test('card tier outranks rating and personalization', () => {
  const imageRich = composeLocationRankingScore({ cardTier: 2, ratingScore: 0.2, relevanceScore: -400 })
  const placeholder = composeLocationRankingScore({ cardTier: 1, ratingScore: 1, relevanceScore: 499 })
  assert.ok(imageRich > placeholder)
})

test('rating outranks personalization inside the same card tier', () => {
  const betterRated = composeLocationRankingScore({ cardTier: 2, ratingScore: 0.9, relevanceScore: -400 })
  const morePersonal = composeLocationRankingScore({ cardTier: 2, ratingScore: 0.7, relevanceScore: 499 })
  assert.ok(betterRated > morePersonal)
})

test('candidate comparator follows tier, rating, then relevance', () => {
  const candidates = [
    { title: 'Personal', card_tier: 2, rating_score: 0.7, relevance_score: 100 },
    { title: 'Rated', card_tier: 2, rating_score: 0.9, relevance_score: 1 },
    { title: 'Premium', card_tier: 3, rating_score: 0.2, relevance_score: 0 }
  ].sort(compareLocationCandidates)
  assert.deepEqual(candidates.map((item) => item.title), ['Premium', 'Rated', 'Personal'])
})
