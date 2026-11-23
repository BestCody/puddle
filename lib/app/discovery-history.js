export const MAX_HISTORY_REFILLS = 3

// Remove places the user has already seen from a search window, searching again
// past them while history consumes the window. Only the candidate IDs in hand
// are checked against history, so the cost does not grow with its length.
//
// initial:   first search result { candidates, candidateLimit, ... }
// search:    excludeIds => next search result
// seenAmong: ids => the subset of ids the user has seen
export async function collectUnseenCandidates({ initial, search, seenAmong, excludeIds = [], limit, maxRefills = MAX_HISTORY_REFILLS }) {
  const excluded = new Set(excludeIds.map(String).filter(Boolean))
  const kept = new Map()
  let result = initial
  // A full window means the catalogue may hold more beyond it.
  let windowFull = initial.candidates.length >= initial.candidateLimit
  let seenTotal = 0

  const removeSeen = async (rows) => {
    const ids = rows.map((row) => String(row?.id || '')).filter((id) => id && !excluded.has(id))
    const seen = ids.length ? await seenAmong(ids) : []
    for (const id of seen) excluded.add(String(id))
    seenTotal += seen.length
    return seen.length
  }
  const keep = (rows) => {
    for (const row of rows) {
      const id = String(row?.id || '')
      if (id && !excluded.has(id) && !kept.has(id)) kept.set(id, row)
    }
  }

  let newlySeen = await removeSeen(initial.candidates)
  keep(initial.candidates)
  for (let round = 0; round < maxRefills && newlySeen && windowFull && kept.size < limit; round += 1) {
    result = await search([...excluded])
    windowFull = result.candidates.length >= result.candidateLimit
    newlySeen = await removeSeen(result.candidates)
    keep(result.candidates)
  }
  return { result: { ...result, candidates: [...kept.values()] }, windowFull, seenTotal, excluded }
}
