export const AUTH_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60

export function authCookieOptions() {
  return {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: false,
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS
  }
}

export function authCookieSetOptions(options = {}) {
  return {
    ...options,
    path: '/',
    sameSite: options.sameSite || 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: options.httpOnly ?? false,
    maxAge: options.maxAge ?? AUTH_COOKIE_MAX_AGE_SECONDS
  }
}
