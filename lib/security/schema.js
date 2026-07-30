function fail(message) { const error = new Error(message); error.status = 400; throw error }
export function object(value, message = 'Request body must be an object.') { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(message); return value }
export function string(value, { name = 'value', min = 0, max = 1000, optional = false, pattern, choices } = {}) {
  if ((value === undefined || value === null || value === '') && optional) return null
  const result = String(value ?? '').trim()
  if (result.length < min || result.length > max) fail(`${name} is invalid.`)
  if (pattern && !pattern.test(result)) fail(`${name} is invalid.`)
  if (choices && !choices.includes(result)) fail(`${name} is invalid.`)
  return result
}
export function uuid(value, name = 'id', optional = false) { return string(value, { name, optional, pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, max: 36 }) }
export function integer(value, { name = 'value', min = 0, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  if ((value === undefined || value === null || value === '') && optional) return null
  const result = Number(value)
  if (!Number.isInteger(result) || result < min || result > max) fail(`${name} is invalid.`)
  return result
}
export function boolean(value, name = 'value') { if (typeof value !== 'boolean') fail(`${name} is invalid.`); return value }
export function record(value, { name = 'metadata', maxBytes = 16_000 } = {}) { object(value, `${name} is invalid.`); if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) fail(`${name} is too large.`); return value }
