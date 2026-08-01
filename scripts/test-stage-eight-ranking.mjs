import assert from 'node:assert/strict'
import { diversifyRecommendations, recommendationIntentBucket, scoreHybridCandidate } from '../lib/app/hybrid-recommendations.js'
import { deterministicAssist, validateGrounding } from '../lib/ai/grounding.js'
import { hashingEmbedding } from '../lib/ai/embedding-provider.js'

const candidate = {
  content_kind: 'event', content_id: 'a', category: 'live_music', distance_m: 1500, starts_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
  ends_at: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString(), remaining_capacity: 10, host_id: 'host-1', host_verified: true,
  popularity_score: 1, friend_score: 1, vector_similarity: 1, published_at: new Date().toISOString(), candidate_sources: ['upcoming']
}
const context = {
  explicitInterests: ['live_music'], positiveCategories: { live_music: 25 }, negativeCategories: {}, followedHosts: ['host-1'], recentTargets: [],
  preferences: { behavioral_enabled: true, friend_activity_enabled: true, vector_enabled: true, explicit_interests_only: false },
  featureFlags: { behavioral: true, vector: true }
}
const ranked = scoreHybridCandidate(candidate, context, { filters: { distance: 25 }, experiment: { variant: 'control', holdout: false }, requestId: 'request' })
assert.ok(ranked.components.explicitInterest > ranked.components.popularity, 'Explicit interests should outweigh popularity')
assert.ok(ranked.components.vectorSimilarity <= 20, 'Vector similarity must be capped')
assert.ok(ranked.explanations.includes('Matches your interest in live music'), 'Explanation must reflect an actual score component')

const holdout = scoreHybridCandidate(candidate, context, { filters: { distance: 25 }, experiment: { variant: 'rules_holdout', holdout: true }, requestId: 'request' })
assert.equal(holdout.components.vectorSimilarity, 0, 'Holdouts must not use vector similarity')
assert.ok(holdout.finalScore < ranked.finalScore, 'Vector-enabled score should exceed the holdout for this fixture')

const negative = scoreHybridCandidate(candidate, { ...context, negativeCategories: { live_music: 12 } }, { filters: { distance: 25 }, experiment: { variant: 'control', holdout: false }, requestId: 'request' })
assert.ok(negative.finalScore < ranked.finalScore, 'Dismissed categories should reduce ranking')

const contextualNow = new Date('2026-08-01T00:30:00.000Z')
const contextualCandidate = {
  content_kind: 'place', content_id: 'cafe-1', category: 'cafe', timezone: 'America/Toronto', price_level: 2,
  amenities: ['outdoor_seating', 'wifi'], distance_m: 3200, open_now: true, host_verified: false,
  popularity_score: 0.2, friend_score: 0, vector_similarity: null, published_at: '2026-07-20T00:00:00.000Z', candidate_sources: ['proximity']
}
const contextualContext = {
  ...context,
  explicitInterests: [], positiveCategories: {}, followedHosts: [],
  contextualConfidence: 1,
  contextualCategory: {
    'global|cafe': 0.35,
    'daypart:evening|cafe': 0.85,
    'daytype:weekday|cafe': 0.45,
    'intent:coffee|cafe': 0.95
  },
  contextualPrice: { 'intent:coffee|2': 0.8 },
  contextualAmenities: { 'intent:coffee|outdoor_seating': 0.75 },
  contextualDistanceKm: { 'intent:coffee|distance': 3.5 }
}
const contextualRanked = scoreHybridCandidate(contextualCandidate, contextualContext, {
  filters: { distance: 10, q: 'coffee patio' }, experiment: { variant: 'control', holdout: false }, requestId: 'context-request', now: contextualNow
})
const contextualBaseline = scoreHybridCandidate(contextualCandidate, { ...contextualContext, contextualConfidence: 0 }, {
  filters: { distance: 10, q: 'coffee patio' }, experiment: { variant: 'control', holdout: false }, requestId: 'context-request', now: contextualNow
})
assert.equal(recommendationIntentBucket({ q: 'coffee patio' }), 'coffee', 'Discovery intent should normalize to a reusable context bucket')
assert.ok(contextualRanked.finalScore > contextualBaseline.finalScore, 'A learned matching context should improve the candidate score')
assert.ok(contextualRanked.components.contextualCategory > contextualRanked.components.contextualDistance, 'Contextual category affinity should remain stronger than learned distance')
assert.ok(contextualRanked.components.contextualCategory <= 12, 'Contextual category affinity must be capped')
assert.ok(contextualRanked.explanations.some((value) => /coffee plans|evening picks/.test(value)), 'Contextual explanations must describe the active situation')

const explicitOnlyContext = scoreHybridCandidate(contextualCandidate, {
  ...contextualContext,
  preferences: { ...contextualContext.preferences, explicit_interests_only: true }
}, {
  filters: { distance: 10, q: 'coffee patio' }, experiment: { variant: 'control', holdout: false }, requestId: 'context-request', now: contextualNow
})
assert.equal(explicitOnlyContext.components.contextualCategory, 0, 'Explicit-interests-only mode must disable contextual behavioral learning')
assert.equal(explicitOnlyContext.components.contextualPrice, 0, 'Explicit-interests-only mode must disable contextual price learning')

const contextMismatch = scoreHybridCandidate({ ...contextualCandidate, category: 'nightlife', price_level: 4, amenities: [] }, contextualContext, {
  filters: { distance: 10, q: 'coffee patio' }, experiment: { variant: 'control', holdout: false }, requestId: 'context-request', now: contextualNow
})
assert.ok(contextualRanked.finalScore > contextMismatch.finalScore, 'The same request should prefer attributes learned for that context')

const negativeContext = scoreHybridCandidate(contextualCandidate, {
  ...contextualContext,
  contextualCategory: { 'intent:coffee|cafe': -0.9 }
}, {
  filters: { distance: 10, q: 'coffee' }, experiment: { variant: 'control', holdout: false }, requestId: 'context-request', now: contextualNow
})
assert.ok(negativeContext.components.contextualCategory < 0, 'Repeated contextual dismissals should create a bounded negative signal')
const noCategoryContext = scoreHybridCandidate(contextualCandidate, { ...contextualContext, contextualCategory: {} }, {
  filters: { distance: 10, q: 'coffee' }, experiment: { variant: 'control', holdout: false }, requestId: 'context-request', now: contextualNow
})
assert.ok(negativeContext.finalScore < noCategoryContext.finalScore, 'Negative contextual affinity should reduce the candidate score')

const diverse = diversifyRecommendations([
  { ...candidate, content_id: '1', score: 100, category: 'music', host_id: 'same' },
  { ...candidate, content_id: '2', score: 99, category: 'music', host_id: 'same' },
  { ...candidate, content_id: '3', score: 98, category: 'art', host_id: 'other' }
], 3)
assert.equal(diverse[1].content_id, '3', 'Diversity should avoid immediate category and host repetition')

const source = { title: 'Community concert', category: 'live_music', summary: 'Local bands at the park.' }
assert.equal(validateGrounding(source, { suggestions: { summary: 'Local bands at the park. Tickets are $25.' } }).allowed, false, 'Invented prices must be blocked')
assert.equal(validateGrounding(source, { suggestions: { summary: 'A community concert with local bands at the park.' } }).allowed, true, 'Grounded wording should pass')
const deterministic = deterministicAssist('event', source)
assert.ok(deterministic.missingFields.some((item) => item.field === 'starts_at'), 'Missing schedule information should be detected')

const vector = hashingEmbedding('live music concert in a park')
assert.equal(vector.length, 768, 'Fallback embeddings must use the pgvector dimension')
const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0))
assert.ok(Math.abs(norm - 1) < 1e-9, 'Fallback embeddings must be L2 normalized')

console.log('Stage 8 ranking, grounding, diversity, holdout, embedding, and contextual learning tests passed.')
