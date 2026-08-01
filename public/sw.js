const SHELL_CACHE = 'puddle-shell-v1'
const RUNTIME_CACHE = 'puddle-runtime-v1'
const SHELL = ['/', '/manifest.webmanifest', '/puddle-app-icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => ![SHELL_CACHE, RUNTIME_CACHE].includes(key)).map((key) => caches.delete(key)))),
    self.clients.claim()
  ]))
})

function privateRequest(url) {
  return url.pathname.startsWith('/api/') || ['/dashboard', '/discover', '/date-match', '/plans', '/map', '/notifications', '/profile', '/account'].some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      const cached = await caches.match('/')
      return cached || new Response('Puddle is offline. Reconnect to refresh your locations.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } })
    }))
    return
  }

  if (privateRequest(url)) return
  if (!['style', 'script', 'image', 'font'].includes(request.destination)) return
  event.respondWith(caches.open(RUNTIME_CACHE).then(async (cache) => {
    const cached = await cache.match(request)
    const fresh = fetch(request).then((response) => {
      if (response.ok) cache.put(request, response.clone())
      return response
    }).catch(() => cached)
    return cached || fresh
  }))
})

async function showPayload(payload = {}) {
  const title = String(payload.title || 'Puddle').slice(0, 120)
  const body = String(payload.body || 'Something changed in your location plans.').slice(0, 320)
  const href = String(payload.href || '/dashboard').startsWith('/') ? payload.href : '/dashboard'
  await self.registration.showNotification(title, {
    body,
    icon: '/puddle-app-icon.svg',
    badge: '/puddle-app-icon.svg',
    tag: String(payload.tag || payload.id || 'puddle-update').slice(0, 120),
    data: { href, notificationId: payload.id || null },
    renotify: Boolean(payload.renotify),
    vibrate: [70, 35, 90],
    actions: [{ action: 'open', title: 'Open Puddle' }]
  })
}

self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data?.json() || {} } catch { payload = { body: event.data?.text() || '' } }
  event.waitUntil(showPayload(payload))
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
  if (event.data?.type === 'SHOW_NOTIFICATION') event.waitUntil(showPayload(event.data.payload || {}))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const href = event.notification.data?.href || '/dashboard'
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const target = new URL(href, self.location.origin).toString()
    for (const client of clients) {
      if ('focus' in client) {
        if ('navigate' in client) await client.navigate(target)
        return client.focus()
      }
    }
    return self.clients.openWindow(target)
  }))
})
