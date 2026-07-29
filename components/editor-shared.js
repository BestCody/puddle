export function formatDateTimeLocal(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function listText(value) {
  if (!value) return ''
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? item : item.question).filter(Boolean).join('\n')
  return String(value)
}

export function contactValue(value, key) {
  return value && typeof value === 'object' ? value[key] || '' : ''
}

export function accessibilityValue(value, key) {
  return Boolean(value && typeof value === 'object' && value[key])
}
