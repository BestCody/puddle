import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseEnv } from './env'

let browserClient

function ensureCatch(request) {
  if (!request || typeof request.catch === 'function') return request
  try {
    Object.defineProperty(request, 'catch', {
      configurable: true,
      value(onRejected) {
        return Promise.resolve(request).catch(onRejected)
      }
    })
  } catch {}
  return request
}

export function createClient() {
  const { url, publishableKey } = getSupabaseEnv()
  if (!browserClient) {
    browserClient = createBrowserClient(url, publishableKey)
    const rpc = browserClient.rpc.bind(browserClient)
    browserClient.rpc = (...args) => ensureCatch(rpc(...args))
  }
  return browserClient
}
