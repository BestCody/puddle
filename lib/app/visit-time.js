// datetime-local has no offset. Interpret it on the user's device, never on the
// server (which may be running in a different timezone).
export function localDateTimeValue(instant) {
  if (!instant) return ''
  const date = new Date(instant)
  if (Number.isNaN(date.getTime())) return ''
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function localDateTimeToISO(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value || ''))) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) || localDateTimeValue(date) !== value ? '' : date.toISOString()
}

export function visitInstant(value) {
  // Reject ambiguous, timezone-less input at every server entry point.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(String(value || ''))) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
