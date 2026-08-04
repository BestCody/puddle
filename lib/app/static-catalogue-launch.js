import { createHash } from 'node:crypto'
import { haversineDistanceMeters } from './static-catalogue.js'

export const STATIC_CANONICAL_INDEX_VERSION = 1
export const STATIC_ENRICHMENT_SCHEMA_VERSION = 1

const SETTLED_STATES = new Set(['matched', 'no_match', 'skipped'])
const KIND_GROUPS = [
  new Set(['cafe', 'restaurant']),
  new Set(['bar', 'nightlife']),
  new Set(['museum', 'gallery', 'attraction']),
  new Set(['park', 'scenic_spot']),
  new Set(['activity_venue', 'community_space'])
]

function text(value, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function normalizedTokens(value) {
  return text(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\b(the|inc|incorporated|llc|ltd|limited|corp|corporation|company|co)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

export function normalizedPlaceName(value) {
  return normalizedTokens(value).join(' ')
}

export function normalizedAddress(value) {
  return normalizedTokens(value)
    .map((token) => ({ street: 'st', streetname: 'st', avenue: 'ave', road: 'rd', boulevard: 'blvd', drive: 'dr' })[token] || token)
    .join(' ')
}

function tokenSimilarity(left, right) {
  const a = new Set(normalizedTokens(left))
  const b = new Set(normalizedTokens(right))
  if (!a.size || !b.size) return 0
  let overlap = 0
  for (const token of a) if (b.has(token)) overlap += 1
  return overlap / Math.max(a.size, b.size)
}

function normalizedPhone(value) {
  return String(value || '').replace(/\D/g, '').slice(-11)
}

function websiteHost(value) {
  try {
    return new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function staticSourceIdentity(value) {
  return `${String(value?.source || '').trim()}:${String(value?.sourcePlaceId || '').trim()}`
}

export function canonicalIndexShard(value) {
  const name = normalizedPlaceName(value?.name)
  return createHash('sha256').update(name || staticSourceIdentity(value)).digest('hex').slice(0, 2)
}

export function compatiblePlaceKinds(left, right) {
  const a = String(left || '')
  const b = String(right || '')
  if (a && a === b) return true
  return KIND_GROUPS.some((group) => group.has(a) && group.has(b))
}

export function crossSourceDuplicateScore(left, right, { maxDistanceM = 175 } = {}) {
  if (!left || !right) return null
  if (staticSourceIdentity(left) === staticSourceIdentity(right)) {
    return { score: 1, exactSource: true, distanceM: 0, nameScore: 1, addressScore: 1, contactExact: true }
  }
  if (String(left.source) === String(right.source)) return null
  const leftName = normalizedPlaceName(left.name)
  const rightName = normalizedPlaceName(right.name)
  if (!leftName || leftName !== rightName) return null
  if (!compatiblePlaceKinds(left.kind, right.kind)) return null

  const distanceM = haversineDistanceMeters(left.latitude, left.longitude, right.latitude, right.longitude)
  if (distanceM === null) return null
  const phoneExact = normalizedPhone(left.phonePublic) && normalizedPhone(left.phonePublic) === normalizedPhone(right.phonePublic)
  const websiteExact = websiteHost(left.websiteUrl) && websiteHost(left.websiteUrl) === websiteHost(right.websiteUrl)
  const contactExact = Boolean(phoneExact || websiteExact)
  if (distanceM > maxDistanceM && !(contactExact && distanceM <= 1_000)) return null

  const addressScore = tokenSimilarity(normalizedAddress(left.addressPublic), normalizedAddress(right.addressPublic))
  const locationScore = 1 - Math.min(1, distanceM / maxDistanceM)
  const veryClose = distanceM <= 40
  if (!veryClose && !contactExact && addressScore < 0.55) return null

  const score = 0.45 + locationScore * 0.25 + addressScore * 0.2 + (contactExact ? 0.1 : 0)
  return {
    score: Math.min(1, score),
    exactSource: false,
    distanceM,
    nameScore: 1,
    addressScore,
    contactExact
  }
}

function objectSize(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : 0
}

export function canonicalQualityScore(item) {
  if (!item) return -Infinity
  let score = Number(item.sourceConfidence || 0) * 2 + Number(item.categoryConfidence || 0)
  if (item.addressPublic) score += 1.2
  if (item.websiteUrl) score += 0.8
  if (item.phonePublic) score += 0.8
  if (item.brandName) score += 0.35
  if (item.postalCode) score += 0.25
  if (item.neighborhood) score += 0.2
  if (Array.isArray(item.amenities)) score += Math.min(0.5, item.amenities.length * 0.05)
  score += Math.min(0.5, objectSize(item.openingHours) * 0.06)
  score += Math.min(0.25, objectSize(item.accessibility) * 0.05)
  if (item.source === 'overture') score += 0.08
  return score
}

function referenceFor(item) {
  const metadata = item?.sourceMetadata && typeof item.sourceMetadata === 'object' ? item.sourceMetadata : {}
  const { catalogueSources: _catalogueSources, launchPartitions: _launchPartitions, ...sourceMetadata } = metadata
  return {
    source: item.source,
    sourcePlaceId: item.sourcePlaceId,
    sourceParentPlaceId: item.sourceParentPlaceId || null,
    sourceUpdatedAt: item.sourceUpdatedAt || null,
    sourceConfidence: item.sourceConfidence ?? null,
    payloadHash: item.payloadHash || null,
    license: metadata.license || metadata.license_code || null,
    licenseUrl: metadata.licenseUrl || metadata.license_url || null,
    attribution: metadata.attribution || null,
    sourceMetadata
  }
}

function uniqueReferences(values) {
  const result = new Map()
  for (const value of values) {
    if (!value?.source || !value?.sourcePlaceId) continue
    result.set(`${value.source}:${value.sourcePlaceId}`, value)
  }
  return [...result.values()].sort((a, b) => `${a.source}:${a.sourcePlaceId}`.localeCompare(`${b.source}:${b.sourcePlaceId}`))
}

function launchPartitions(item) {
  const values = item?.sourceMetadata?.launchPartitions
  return Array.isArray(values) ? values.map(String).filter(Boolean) : []
}

export function withStaticSourceProvenance(item, { partition = null, raw = null } = {}) {
  const rawRecord = raw && typeof raw === 'object' ? raw : {}
  const metadata = item?.sourceMetadata && typeof item.sourceMetadata === 'object' ? item.sourceMetadata : {}
  const rawLicense = rawRecord.license || rawRecord.license_code || rawRecord.dataset_license || null
  const rawLicenseUrl = rawRecord.license_url || rawRecord.licenseUrl || rawRecord.terms_url || null
  const rawAttribution = rawRecord.attribution || rawRecord.attribution_text || null
  const enriched = {
    ...item,
    sourceMetadata: {
      ...metadata,
      ...(rawLicense ? { license: text(rawLicense, 120) } : {}),
      ...(rawLicenseUrl ? { licenseUrl: text(rawLicenseUrl, 500) } : {}),
      ...(rawAttribution ? { attribution: text(rawAttribution, 500) } : {}),
      launchPartitions: [...new Set([...launchPartitions(item), ...(partition ? [String(partition)] : [])])]
    }
  }
  enriched.sourceMetadata.catalogueSources = uniqueReferences([
    ...(Array.isArray(metadata.catalogueSources) ? metadata.catalogueSources : []),
    referenceFor(enriched)
  ])
  return enriched
}

export function mergeCanonicalPlaces(current, incoming, options = {}) {
  if (!current) {
    const canonical = withStaticSourceProvenance(incoming, options)
    return { canonical, duplicate: false, replacedIdentity: null, match: null }
  }
  const enrichedIncoming = withStaticSourceProvenance(incoming, options)
  const match = crossSourceDuplicateScore(current, enrichedIncoming, options)
  if (!match) return null

  const currentIdentity = staticSourceIdentity(current)
  const incomingIdentity = staticSourceIdentity(enrichedIncoming)
  let winner = current
  if (currentIdentity === incomingIdentity) {
    winner = canonicalQualityScore(enrichedIncoming) >= canonicalQualityScore(current) ? enrichedIncoming : current
  } else {
    const difference = canonicalQualityScore(enrichedIncoming) - canonicalQualityScore(current)
    winner = difference > 0.0001 || (Math.abs(difference) <= 0.0001 && incomingIdentity.localeCompare(currentIdentity) < 0)
      ? enrichedIncoming
      : current
  }

  const references = uniqueReferences([
    ...(Array.isArray(current?.sourceMetadata?.catalogueSources) ? current.sourceMetadata.catalogueSources : [referenceFor(current)]),
    ...(Array.isArray(enrichedIncoming?.sourceMetadata?.catalogueSources) ? enrichedIncoming.sourceMetadata.catalogueSources : [referenceFor(enrichedIncoming)])
  ])
  const partitions = [...new Set([...launchPartitions(current), ...launchPartitions(enrichedIncoming)])]
  const canonical = {
    ...winner,
    sourceMetadata: {
      ...(winner.sourceMetadata || {}),
      catalogueSources: references,
      launchPartitions: partitions
    }
  }
  return {
    canonical,
    duplicate: currentIdentity !== incomingIdentity,
    replacedIdentity: staticSourceIdentity(canonical) === currentIdentity ? null : currentIdentity,
    match
  }
}

export function enrichmentStatusObjectKey(release, tile) {
  return `catalogue/enrichment/${encodeURIComponent(String(release))}/${tile.z}/${tile.x}/${tile.y}.json`
}

export function enrichmentCheckpointObjectKey(release, worker) {
  return `catalogue/enrichment/${encodeURIComponent(String(release))}/checkpoints/${encodeURIComponent(String(worker))}.json`
}

export function emptyEnrichmentStatus() {
  return {
    photoState: null,
    googleState: null,
    photoAttemptedAt: null,
    googleAttemptedAt: null,
    photoError: null,
    googleError: null
  }
}

export function unpackEnrichmentStatusRow(row) {
  if (!Array.isArray(row) || !row[0]) return null
  return {
    staticLocationId: String(row[0]),
    photoState: row[1] || null,
    googleState: row[2] || null,
    photoAttemptedAt: row[3] || null,
    googleAttemptedAt: row[4] || null,
    photoError: row[5] || null,
    googleError: row[6] || null
  }
}

export function packEnrichmentStatusRow(staticLocationId, status = {}) {
  return [
    String(staticLocationId),
    status.photoState || null,
    status.googleState || null,
    status.photoAttemptedAt || null,
    status.googleAttemptedAt || null,
    status.photoError ? text(status.photoError, 900) : null,
    status.googleError ? text(status.googleError, 900) : null
  ]
}

export function isEnrichmentStateSettled(value) {
  return SETTLED_STATES.has(String(value || ''))
}

export function mergeEnrichmentStatus(current = {}, patch = {}) {
  return { ...emptyEnrichmentStatus(), ...current, ...patch }
}
