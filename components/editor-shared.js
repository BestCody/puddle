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
