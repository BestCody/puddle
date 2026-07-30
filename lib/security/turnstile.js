const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

function required() { return String(process.env.TURNSTILE_REQUIRED || '').toLowerCase() === 'true' }

export async function verifyTurnstile({ token, action, remoteIp }) {
  const secret = String(process.env.TURNSTILE_SECRET_KEY || '').trim()
  if (!secret) return required() ? { success: false, outcome: 'not_configured' } : { success: true, outcome: 'disabled' }
  if (!token || typeof token !== 'string' || token.length > 2048) return { success: false, outcome: 'invalid_token' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(SITEVERIFY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: remoteIp || undefined, idempotency_key: crypto.randomUUID() }),
      signal: controller.signal,
      cache: 'no-store'
    })
    const result = await response.json().catch(() => ({}))
    const hostname = String(process.env.TURNSTILE_EXPECTED_HOSTNAME || '').trim()
    const actionMatches = !action || result.action === action
    const hostMatches = !hostname || result.hostname === hostname
    return { success: Boolean(response.ok && result.success && actionMatches && hostMatches), outcome: result.success ? actionMatches && hostMatches ? 'verified' : 'context_mismatch' : String(result['error-codes']?.[0] || 'failed'), challengeTs: result.challenge_ts || null }
  } catch (error) {
    return { success: false, outcome: error?.name === 'AbortError' ? 'timeout' : 'unavailable' }
  } finally { clearTimeout(timer) }
}
