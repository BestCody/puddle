import { embedLocalTexts, getLocalAiConfig } from './local-provider.js'

const DIMENSIONS = 768

function hash(value, seed = 2166136261) {
  let result = seed >>> 0
  for (const character of String(value || '')) {
    result ^= character.charCodeAt(0)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

function tokens(value) {
  const normalized = String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s_-]/g, ' ').replace(/\s+/g, ' ').trim()
  const words = normalized.split(' ').filter(Boolean).slice(0, 3000)
  const features = [...words]
  for (const word of words) {
    const padded = `^${word}$`
    for (let index = 0; index <= padded.length - 3; index += 1) features.push(padded.slice(index, index + 3))
  }
  for (let index = 0; index < words.length - 1; index += 1) features.push(`${words[index]}_${words[index + 1]}`)
  return features
}

export function hashingEmbedding(value, dimensions = DIMENSIONS) {
  const vector = Array.from({ length: dimensions }, () => 0)
  for (const feature of tokens(value)) {
    const first = hash(feature)
    const second = hash(feature, 2246822519)
    const index = first % dimensions
    const sign = (second & 1) === 0 ? 1 : -1
    vector[index] += sign * (1 + Math.min(3, feature.length / 10))
  }
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1
  return vector.map((item) => item / norm)
}

export async function embedWithoutExternalKey(inputs) {
  const values = Array.isArray(inputs) ? inputs : [inputs]
  const preference = String(process.env.LOCAL_AI_EMBEDDING_PROVIDER || 'hashing').toLowerCase()
  const local = getLocalAiConfig()
  if (preference === 'ollama' && local.configured) return embedLocalTexts(values)
  return {
    embeddings: values.map((value) => hashingEmbedding(value, DIMENSIONS)),
    provider: 'local_hashing',
    model: 'puddle-feature-hashing',
    modelVersion: 'puddle-feature-hashing-v1',
    dimensions: DIMENSIONS
  }
}
