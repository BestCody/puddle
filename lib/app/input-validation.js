export const MIN_ACCOUNT_AGE = 13
export const MAX_ACCOUNT_AGE = 120
export const MAX_EMAIL_LENGTH = 254
export const MAX_PASSWORD_LENGTH = 128

export function isValidEmail(value) {
  const email = String(value || '').trim()
  if (!email || email.length > MAX_EMAIL_LENGTH) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function sanitizeUsername(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 24)
}

export function formatBirthDateDigits(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 4) return digits
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`
}

function dateParts(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function isRealDate({ year, month, day }) {
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(year, month - 1, day)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function ageFromBirthDate(value, now = new Date()) {
  const parts = dateParts(value)
  if (!parts || !isRealDate(parts)) return null
  const { year, month, day } = parts
  let age = now.getUTCFullYear() - year
  const monthDifference = now.getUTCMonth() - (month - 1)
  if (monthDifference < 0 || (monthDifference === 0 && now.getUTCDate() < day)) age -= 1
  return age
}

export function birthDateError(value, now = new Date()) {
  const input = String(value || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return 'Enter all 8 birth-date numbers in YYYY-MM-DD format.'
  const parts = dateParts(input)
  if (!parts || !isRealDate(parts)) return 'Enter a real calendar date.'

  const birthday = new Date(0)
  birthday.setUTCHours(0, 0, 0, 0)
  birthday.setUTCFullYear(parts.year, parts.month - 1, parts.day)
  if (birthday.getTime() > now.getTime()) return 'Birth date cannot be in the future.'

  const age = ageFromBirthDate(input, now)
  if (age === null) return 'Enter a real calendar date.'
  if (age < MIN_ACCOUNT_AGE) return `Puddle accounts require users to be at least ${MIN_ACCOUNT_AGE}.`
  if (age > MAX_ACCOUNT_AGE) return 'Enter a realistic birth date.'
  return ''
}
