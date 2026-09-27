export function projectRefFromUrl(value) {
  const hostname = new URL(value).hostname
  const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(hostname)
  if (!match) throw new Error('A hosted Supabase project URL is required for the management backfill.')
  return match[1]
}

export function createManagementQuery({ projectUrl, accessToken, fetchFn = fetch }) {
  if (!accessToken) throw new Error('SUPABASE_ACCESS_TOKEN is required for the management backfill.')
  const projectRef = projectRefFromUrl(projectUrl)
  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`

  return async function querySql(query, parameters = []) {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, parameters })
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(`Supabase management query failed (${response.status}): ${result?.message || result?.error || 'unknown error'}`)
    }
    if (!Array.isArray(result)) throw new Error('Supabase management query returned an unexpected result.')
    return result
  }
}
