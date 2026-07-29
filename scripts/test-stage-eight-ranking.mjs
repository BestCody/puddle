import assert from 'node:assert/strict'
import { diversifyRecommendations, scoreHybridCandidate } from '../lib/app/hybrid-recommendations.js'
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

console.log('Stage 8 ranking, grounding, diversity, holdout, and embedding tests passed.')
