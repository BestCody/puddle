const POSITIVE_CHOICES = new Set(['save', 'perfect'])

export function normalizeDateMatchChoice(value) {
  const choice = String(value || '').trim().toLowerCase()
  if (choice === 'dismissed') return 'pass'
  if (choice === 'saved') return 'save'
  return ['pass', 'save', 'perfect'].includes(choice) ? choice : null
}

export function sanitizeDateMatchNote(value, max = 280) {
  const note = String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
  return note || null
}

export function isPositiveDateMatchChoice(value) {
  return POSITIVE_CHOICES.has(normalizeDateMatchChoice(value))
}

export function dateMatchStrength(first, second) {
  const a = normalizeDateMatchChoice(first)
  const b = normalizeDateMatchChoice(second)
  if (!POSITIVE_CHOICES.has(a) || !POSITIVE_CHOICES.has(b)) return 0
  return 2 + Number(a === 'perfect') + Number(b === 'perfect')
}

export function puddlePickReasons(item = {}) {
  const reasons = []
  const category = String(item.category || item.kind || '')
  const distance = Number(item.distance_m)
  const price = Number(item.price_level)
  const amenities = new Set((item.amenities || []).map((value) => String(value).toLowerCase()))

  if (Number.isFinite(distance) && distance <= 5000) reasons.push('Close enough to keep planning easy')
  if (price === 1 || price === 2) reasons.push('Comfortable everyday price range')
  if (['cafe', 'museum', 'gallery', 'park', 'scenic_spot', 'study_spot'].includes(category)) reasons.push('Easy setting for conversation')
  if (['activity_venue', 'attraction'].includes(category)) reasons.push('Built-in activity and conversation starter')
  if (amenities.has('outdoors') || amenities.has('views')) reasons.push('Good for a walk or a memorable view')
  if (item.open_now) reasons.push('Open right now')
  return [...new Set(reasons)].slice(0, 4)
}

export function shouldPromptDateFeedback(match, now = new Date()) {
  if (!match?.planned_for || match.feedback) return false
  const planned = new Date(match.planned_for)
  if (Number.isNaN(planned.getTime())) return false
  return now.getTime() >= planned.getTime() + 24 * 60 * 60 * 1000
}
