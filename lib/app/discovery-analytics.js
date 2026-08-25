function sampled(requestId, rate = Number(process.env.DISCOVERY_ANALYTICS_SAMPLE_RATE || 0.1)) {
  const threshold = Math.max(0, Math.min(1, Number(rate) || 0)) * 256
  const byte = Number.parseInt(String(requestId || '').replaceAll('-', '').slice(-2), 16)
  return Number.isFinite(byte) && byte < threshold
}

export async function recordSampledDiscoveryAnalytics(session, feed) {
  if (!feed?.items?.length || !sampled(feed.requestId)) return false
  const scores = feed.items.map((item) => Number(item.score || 0)).filter(Number.isFinite)
  const result = await session.supabase.rpc('record_discovery_session_sample_v1', {
    sample: {
      requestId: feed.requestId,
      rankingVersion: feed.rankingVersion,
      centerLat: feed.center?.latitude ?? null,
      centerLng: feed.center?.longitude ?? null,
      filters: feed.filters || {},
      candidateIds: feed.items.slice(0, 40).map((item) => item.content_id),
      rankPositions: feed.items.slice(0, 40).map((_, index) => index + 1),
      scoreSummary: {
        min: scores.length ? Math.min(...scores) : null,
        max: scores.length ? Math.max(...scores) : null,
        mean: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null,
        timings: feed.infrastructure?.timings || null,
        candidateCache: feed.infrastructure?.candidateCache || null
      }
    }
  })
  if (result.error) throw result.error
  return true
}
