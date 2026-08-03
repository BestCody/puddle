function parseClock(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2] || 0)
  const period = match[3]?.toLowerCase()
  if (period === 'pm' && hour < 12) hour += 12
  if (period === 'am' && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

export function isOpenAt(openingHours, timezone, at = new Date()) {
  if (!openingHours || typeof openingHours !== 'object') return false
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      weekday: 'long',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    })
    const parts = Object.fromEntries(formatter.formatToParts(at).map((part) => [part.type, part.value]))
    const value = String(openingHours[String(parts.weekday || '').toLowerCase()] || '').trim()
    if (!value || /^closed$/i.test(value)) return false
    if (/24\s*hours|open\s*24/i.test(value)) return true

    const [rawStart, rawEnd] = value.replace(/[–—]/g, '-').split('-').map((part) => part.trim())
    const start = parseClock(rawStart)
    const end = parseClock(rawEnd)
    if (start === null || end === null) return true

    const nowMinutes = Number(parts.hour) * 60 + Number(parts.minute)
    return end >= start
      ? nowMinutes >= start && nowMinutes < end
      : nowMinutes >= start || nowMinutes < end
  } catch {
    return false
  }
}
