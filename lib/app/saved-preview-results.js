export function resolveSavedPreviewBatch(requestedIds, items) {
  const requested = new Set(requestedIds.map(String))
  const found = {}
  for (const item of items) {
    const id = String(item?.id || '')
    if (requested.has(id)) found[id] = item
  }
  const missingIds = requestedIds.filter((id) => !found[String(id)])
  const previews = { ...found }
  for (const id of missingIds) {
    previews[String(id)] = {
      unavailable: true,
      title: 'Place unavailable',
      city: 'Details unavailable. Try again.'
    }
  }
  return { previews, missingIds }
}
