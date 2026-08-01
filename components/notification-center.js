"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { csrfFetch } from '@/lib/security/csrf-client'

function relativeTime(value) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function icon(kind) {
  if (kind === 'group_joined') return '●+'
  if (kind === 'match_found') return '♡'
  if (kind === 'plan_scheduled' || kind === 'plan_reminder') return '⌖'
  if (kind === 'feedback_ready') return '★'
  return 'P'
}

export function NotificationCenter({ initialSnapshot }) {
  const [items, setItems] = useState(initialSnapshot.items || [])
  const [permission, setPermission] = useState('default')
  const [pushEnabled, setPushEnabled] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [message, setMessage] = useState('')
  const unread = items.filter((item) => !item.read_at).length

  useEffect(() => {
    setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
    setInstalled(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true)
    fetch('/api/push/subscriptions', { cache: 'no-store' }).then((response) => response.ok ? response.json() : null).then((payload) => setPushEnabled(Boolean(payload?.enabled))).catch(() => {})
    function status(event) { if (event.detail?.permission) setPermission(event.detail.permission); if (event.detail?.message) setMessage(event.detail.message) }
    window.addEventListener('puddle:pwa-status', status)
    return () => window.removeEventListener('puddle:pwa-status', status)
  }, [])

  async function markRead(id = null) {
    const response = await csrfFetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: id ? 'read' : 'read_all', id }) })
    if (!response.ok) return setMessage('Notifications could not be updated.')
    const now = new Date().toISOString()
    setItems((current) => current.map((item) => !id || item.id === id ? { ...item, read_at: item.read_at || now } : item))
  }

  async function disablePush() {
    try {
      const registration = await navigator.serviceWorker?.ready
      const subscription = await registration?.pushManager?.getSubscription()
      const endpoint = subscription?.endpoint || null
      await subscription?.unsubscribe()
      const response = await csrfFetch('/api/push/subscriptions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(endpoint ? { endpoint } : {}) })
      if (!response.ok) throw new Error('disable failed')
      setPushEnabled(false); setMessage('Background notifications are disabled on this device.')
    } catch { setMessage('Notifications could not be disabled from this browser.') }
  }

  function enablePush() {
    window.dispatchEvent(new Event('puddle:enable-notifications'))
    window.setTimeout(() => fetch('/api/push/subscriptions', { cache: 'no-store' }).then((response) => response.ok ? response.json() : null).then((payload) => setPushEnabled(Boolean(payload?.enabled))).catch(() => {}), 1800)
  }

  return <div className="notification-center">
    <section className="notification-preference-grid">
      <article className="notification-setting-card"><span className="section-pill section-pill-mint">Install Puddle</span><h2>{installed ? 'Puddle is installed.' : 'Keep Puddle one tap away.'}</h2><p>Open directly into Home, Swipe, Saved, or the focused map with a standalone mobile experience.</p><button type="button" onClick={() => window.dispatchEvent(new Event('puddle:install'))} disabled={installed}>{installed ? 'Installed' : 'Install Puddle'}</button></article>
      <article className="notification-setting-card"><span className="section-pill">Device alerts</span><h2>{pushEnabled ? 'Background alerts are on.' : permission === 'granted' ? 'Notification permission is on.' : 'Do not miss a group match.'}</h2><p>Get alerted when someone joins, a shared location matches, or a plan is scheduled. Puddle never sends general social noise.</p>{pushEnabled ? <button type="button" onClick={disablePush}>Disable on this device</button> : <button type="button" onClick={enablePush} disabled={permission === 'denied'}>{permission === 'denied' ? 'Blocked in browser settings' : 'Enable notifications'}</button>}</article>
    </section>
    {message ? <p className="date-swipe-message" role="status">{message}</p> : null}
    <section className="notification-feed">
      <header><div><span className="section-pill section-pill-yellow">Activity</span><h2>{unread ? `${unread} thing${unread === 1 ? '' : 's'} need attention` : 'You are caught up.'}</h2></div>{unread ? <button type="button" onClick={() => markRead()}>Mark all read</button> : null}</header>
      {items.length ? <div>{items.map((item) => <article className={item.read_at ? 'is-read' : 'is-unread'} key={item.id}><span className={`notification-kind is-${item.kind}`} aria-hidden="true">{icon(item.kind)}</span><div><small>{relativeTime(item.created_at)}</small><h3>{item.title}</h3><p>{item.body}</p><Link href={item.href || '/dashboard'} onClick={() => markRead(item.id)}>Open →</Link></div>{!item.read_at ? <button type="button" onClick={() => markRead(item.id)} aria-label={`Mark ${item.title} read`}>✓</button> : null}</article>)}</div> : <div className="notification-empty"><span aria-hidden="true">♡</span><h3>No activity yet.</h3><p>Group joins, location matches, plans, reminders, and feedback prompts will appear here.</p><Link href="/discover">Start a shared deck</Link></div>}
    </section>
  </div>
}
