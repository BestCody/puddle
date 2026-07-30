const linkMessages = new Map([
  ['access_denied', 'Sign-in was cancelled or was not approved. Please try again.'],
  ['bad_code_verifier', 'This sign-in attempt could not be completed in this browser. Start again from the sign-in page.'],
  ['callback_failed', 'We could not finish signing you in. Please start again.'],
  ['confirmation_failed', 'That authentication link could not be verified. Please request a new one.'],
  ['flow_state_expired', 'This sign-in attempt has expired. Please start again.'],
  ['flow_state_not_found', 'This sign-in attempt is no longer available. Please start again.'],
  ['invalid_confirmation_link', 'That authentication link is incomplete or invalid. Please request a new one.'],
  ['invalid_token', 'This authentication link has expired or has already been used. Please request a new one.'],
  ['missing_auth_code', 'That sign-in link is incomplete. Please start again from the sign-in page.'],
  ['otp_disabled', 'This authentication link has expired or has already been used. Please request a new one.'],
  ['otp_expired', 'This authentication link has expired or has already been used. Please request a new one.'],
  ['same_password', 'Choose a password that is different from your current password.']
])

function normalizedCode(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 80)
}

export function safeAuthErrorCode(value, fallback = 'authentication_failed') {
  return normalizedCode(value) || fallback
}

export function authLinkErrorMessage(code, fallback = 'We could not finish signing you in. Please start again.') {
  return linkMessages.get(normalizedCode(code)) || fallback
}

export function isDuplicateUsernameError(error) {
  const code = String(error?.code || '')
  const details = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`
  return code === '23505' && /profiles.*username|username.*unique|profiles_username_key/i.test(details)
}

export function profileWriteErrorMessage(error, fallback = 'We could not save your profile. Please try again.') {
  if (isDuplicateUsernameError(error)) return 'That username is already taken. Try another one.'
  const code = String(error?.code || '')
  if (code === '23514') return 'Some profile information was not accepted. Review the highlighted fields and try again.'
  if (code === '42501') return 'Your session could not save this profile. Sign in again and retry.'
  return fallback
}
