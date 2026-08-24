function safeTransitionKey(value) {
  const safe = String(value || 'location').trim().replace(/[^a-zA-Z0-9_-]+/g, '-') || 'location'
  return safe.startsWith('-') ? `location${safe}` : safe
}

export function savedLocationTransitionNames(value) {
  const key = safeTransitionKey(value)
  return {
    card: `puddle-saved-card-${key}`,
    photo: `puddle-saved-photo-${key}`,
    title: `puddle-saved-title-${key}`,
    meta: `puddle-saved-meta-${key}`
  }
}
