import { findStaticOpenPhotoCandidates } from './static-open-photo-provider.js'

const MAPILLARY_FIELDS = 'id,thumb_2048_url,width,height,creator'

async function exactMapillaryCandidate(externalId) {
  const token = String(process.env.MAPILLARY_ACCESS_TOKEN || '').trim()
  const id = String(externalId || '').trim()
  if (!token || !/^\d+$/.test(id)) return null

  const url = new URL(`https://graph.mapillary.com/${encodeURIComponent(id)}`)
  url.searchParams.set('access_token', token)
  url.searchParams.set('fields', MAPILLARY_FIELDS)
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(4_000)
  })
  if (response.status === 404) return null
  if (!response.ok) {
    const error = new Error(`Mapillary image lookup returned ${response.status}.`)
    error.status = response.status >= 500 ? 502 : response.status
    throw error
  }

  const row = await response.json()
  if (String(row?.id || '') !== id || !row?.thumb_2048_url) return null
  const creator = String(row?.creator?.username || row?.creator?.name || 'Mapillary contributor').trim()
  return {
    provider: 'mapillary',
    externalId: id,
    assetUrl: row.thumb_2048_url,
    pageUrl: `https://www.mapillary.com/app/?pKey=${encodeURIComponent(id)}&focus=photo`,
    attribution: `${creator} · Mapillary · CC BY-SA 4.0`,
    license: 'CC-BY-SA-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    width: Number(row?.width) || null,
    height: Number(row?.height) || null,
    score: 1,
    diagnostics: { approvedIdentity: true }
  }
}

export async function findApprovedOpenPhotoCandidate(location, approved) {
  const provider = String(approved?.provider || '')
  const externalId = String(approved?.external_photo_id || '').trim()
  if (!provider || !externalId) return null

  if (provider === 'mapillary') return exactMapillaryCandidate(externalId)

  const result = await findStaticOpenPhotoCandidates(location, { maxCandidatesPerProvider: 10 })
  return (result.candidates || []).find((candidate) =>
    String(candidate.provider || '') === provider && String(candidate.externalId || '') === externalId
  ) || null
}
