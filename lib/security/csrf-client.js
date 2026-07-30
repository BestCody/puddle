"use client"

let tokenPromise = null

async function csrfToken(force = false) {
  if (force) tokenPromise = null
  if (!tokenPromise) {
    tokenPromise = fetch('/api/security/csrf', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin'
    }).then(async (response) => {
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.token) throw new Error('Security token is unavailable.')
      return result.token
    }).catch((error) => {
      tokenPromise = null
      throw error
    })
  }
  return tokenPromise
}

async function send(input, init, forceToken) {
  const headers = new Headers(init?.headers || {})
  headers.set('x-puddle-csrf', await csrfToken(forceToken))
  return fetch(input, { ...init, headers, credentials: init?.credentials || 'same-origin' })
}

export async function csrfFetch(input, init = {}) {
  let response = await send(input, init, false)
  if (response.status === 403) response = await send(input, init, true)
  return response
}

export function clearCsrfToken() {
  tokenPromise = null
}
