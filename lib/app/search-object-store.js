import { downloadSelfHostObject, selfHostObjectConfig } from '../storage/self-host-object-store.js'

const objectDownloadInFlight = new Map()

export function hasSearchObjectStore(env = process.env) {
  try {
    selfHostObjectConfig(env)
    return true
  } catch {
    return false
  }
}

export async function downloadSearchObject(key, {
  env = process.env,
  maxBytes = 32 * 1024 * 1024,
  signal,
  missingOk = false
} = {}) {
  const objectKey = String(key || '').trim().replace(/^\/+/, '')
  if (!objectKey) throw new Error('Search object key is required.')
  if (signal?.aborted) throw signal.reason || new DOMException('The operation was aborted.', 'AbortError')

  // A cancelled query must not share another query's in-flight download.
  if (signal) return downloadSelfHostObject(objectKey, { env, maxBytes, signal, missingOk })
  const inFlightKey = `${objectKey}:${maxBytes}:${missingOk ? 'missing' : 'required'}`
  const existing = objectDownloadInFlight.get(inFlightKey)
  if (existing?.env === env) return existing.promise

  const promise = downloadSelfHostObject(objectKey, { env, maxBytes, missingOk })
  objectDownloadInFlight.set(inFlightKey, { env, promise })
  try {
    return await promise
  } finally {
    if (objectDownloadInFlight.get(inFlightKey)?.promise === promise) objectDownloadInFlight.delete(inFlightKey)
  }
}

export function clearSearchObjectInFlightForTests() {
  objectDownloadInFlight.clear()
}
