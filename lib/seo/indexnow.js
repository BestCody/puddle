// IndexNow pushes changed URLs straight into Bing and Yandex instead of waiting to be
// recrawled. ChatGPT search and Copilot read the Bing index, so this is the shortest path
// from "a hub page exists" to "an answer engine can cite it".
//
// The key is deliberately public: the protocol proves ownership by serving the same value
// at keyLocation on the host. It is not a credential.

const ENDPOINT = 'https://api.indexnow.org/indexnow'
// IndexNow accepts at most 10,000 URLs per submission.
const MAX_URLS_PER_BATCH = 10000

export function indexNowKey() {
  return String(process.env.INDEXNOW_KEY || '').trim()
}

export function isIndexNowConfigured() {
  return indexNowKey().length >= 8
}

function chunk(items, size) {
  const out = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

export async function submitToIndexNow(urls, options = {}) {
  const key = indexNowKey()
  if (!key) return { submitted: 0, batches: [], skipped: 'INDEXNOW_KEY is not set.' }

  const unique = [...new Set((urls || []).map((value) => String(value || '').trim()).filter(Boolean))]
  if (!unique.length) return { submitted: 0, batches: [] }

  const host = new URL(unique[0]).host
  const keyLocation = `https://${host}/indexnow-key.txt`
  const fetchFn = options.fetchFn || globalThis.fetch
  const batches = []

  for (const urlList of chunk(unique, MAX_URLS_PER_BATCH)) {
    try {
      const response = await fetchFn(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host, key, keyLocation, urlList })
      })
      batches.push({ count: urlList.length, status: response.status, ok: response.ok })
    } catch (error) {
      // A failed ping costs nothing but a slower recrawl, so it never propagates.
      batches.push({ count: urlList.length, status: 0, ok: false, error: String(error?.message || error) })
    }
  }

  return { submitted: unique.length, batches }
}
