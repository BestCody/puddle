import { getSupabaseEnv } from './env.js'

export function privateSupabaseUrl(input, publicUrl, internalUrl) {
  if (!internalUrl) throw new Error('SUPABASE_INTERNAL_URL is required for server-side Supabase requests')
  const source = new URL(input instanceof Request ? input.url : String(input))
  const publicOrigin = new URL(publicUrl).origin
  if (source.origin !== publicOrigin) throw new Error('Supabase transport refused a request to another origin')
  const internalOrigin = new URL(internalUrl).origin
  return new URL(`${source.pathname}${source.search}`, internalOrigin)
}

export function supabaseServerFetch(input, init) {
  const { url } = getSupabaseEnv()
  const target = privateSupabaseUrl(input, url, process.env.SUPABASE_INTERNAL_URL)
  return fetch(input instanceof Request ? new Request(target, input) : target, init)
}
