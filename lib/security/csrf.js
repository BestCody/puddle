import { timingSafeEqual } from 'node:crypto'

export function csrfCookieName() { return process.env.NODE_ENV === 'production' ? '__Host-puddle-csrf' : 'puddle-csrf' }
export function csrfCookieOptions() { return { path: '/', httpOnly: false, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 60 * 60 } }
export function verifyCsrf(request) {
  const cookie = request.cookies.get(csrfCookieName())?.value || ''
  const header = request.headers.get('x-puddle-csrf') || ''
  if (!cookie || !header) return false
  const left = Buffer.from(cookie)
  const right = Buffer.from(header)
  return left.length === right.length && timingSafeEqual(left, right)
}
