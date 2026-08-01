"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { csrfFetch } from '@/lib/security/csrf-client'

const APP_PREFIXES = ['/dashboard', '/discover', '/date-match', '/plans', '/map', '/notifications', '/profile', '/account']

function base64UrlBytes(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const binary = atob((value + padding).replaceAll('-', '+').replaceAll('_', '/'))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
}

export function PwaClient() {
  const pathname = usePathname()
  const firstPoll = useRef(true)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [installed, setInstalled] = useState(false)
  const [permission, setPermission] = useState('default')
  const [unreadCount, setUnreadCount] = useState(0)
  const [status, setStatus] = useState('')
  const appSurface = APP_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))

  useEffect(() => {
    setInstalled(isStandalone())
    setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
    function beforeInstall(event) { event.preventDefault(); setInstallPrompt(event) }
    function installedHandler() { setInstalled(true); setInstallPrompt(null); setStatus('Puddle was added to this device.') }
    window.addEventListener('beforeinstallprompt', beforeInstall)
    window.addEventListener('appinstalled', installedHandler)
    return () => { window.removeEventListener('beforeinstallprompt', beforeInstall); window.removeEventListener('appinstalled', installedHandler) }
  }, [])

  useEffect(() => {
    if (!appSurface) return
    let cancelled = false
    async function poll() {
      const response = await fetch('/api/notifications?unread=1', { cache: 'no-store' })
      if (!response.ok || cancelled) return
      const payload = await response.json().catch(() => ({}))
      const items = payload.items || []
      setUnreadCount(Number(payload.unreadCount || items.length || 0))
      try { if ('setAppBadge' in navigator) Number(payload.unreadCount || 0) ? await navigator.setAppBadge(Number(payload.unreadCount)) : await navigator.clearAppBadge() } catch {}
      const latest = items[0]
      const seen = localStorage.getItem('puddle:last-device-notification')
      if (!firstPoll.current && latest && latest.id !== seen && Notification.permission === 'granted') {
        const registration = await navigator.serviceWorker?.ready
        await registration?.showNotification(latest.title, { body: latest.body, icon: '/puddle-app-icon.svg', badge: '/puddle-app-icon.svg', tag: latest.id, data: { href: latest.href || '/dashboard', notificationId: latest.id }, vibrate: [70, 35, 90] })
        localStorage.setItem('puddle:last-device-notification', latest.id)
      } else if (firstPoll.current && latest) localStorage.setItem('puddle:last-device-notification', latest.id)
      firstPoll.current = false
    }
    poll()
    const interval = window.setInterval(poll, 60_000)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [appSurface])

  useEffect(() => {
    async function enableFromEvent() { await enableNotifications() }
    async function installFromEvent() { await installApp() }
    window.addEventListener('puddle:enable-notifications', enableFromEvent)
    window.addEventListener('puddle:install', installFromEvent)
    return () => { window.removeEventListener('puddle:enable-notifications', enableFromEvent); window.removeEventListener('puddle:install', installFromEvent) }
  })

  async function installApp() {
    if (!installPrompt) { setStatus(installed ? 'Puddle is already installed.' : 'Use your browser menu and choose Add to Home Screen.'); return }
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === 'accepted') setStatus('Installing Puddle…')
    setInstallPrompt(null)
  }

  async function enableNotifications() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) { setStatus('This browser does not support device notifications.'); return }
    const nextPermission = await Notification.requestPermission()
    setPermission(nextPermission)
    if (nextPermission !== 'granted') { setStatus('Notification permission was not enabled.'); return }
    const registration = await navigator.serviceWorker.ready
    const statusResponse = await fetch('/api/push/subscriptions', { cache: 'no-store' })
    const pushStatus = await statusResponse.json().catch(() => ({}))
    const publicKey = pushStatus.publicKey
    if (publicKey && registration.pushManager) {
      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlBytes(publicKey) })
      const serialized = subscription.toJSON()
      const response = await csrfFetch('/api/push/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(serialized) })
      if (!response.ok) { setStatus('Permission is on, but this device could not be registered.'); return }
      setStatus('Background notifications are enabled on this device.')
    } else setStatus('Device notifications are enabled while Puddle is active. Add VAPID keys to enable closed-app delivery.')
    window.dispatchEvent(new CustomEvent('puddle:pwa-status', { detail: { permission: nextPermission, message: status } }))
  }

  if (!appSurface) return null
  return <>
    <div className="pwa-utility-dock" aria-label="Puddle app controls">
      {!installed && installPrompt ? <button type="button" onClick={installApp}><span aria-hidden="true">⇩</span> Install</button> : null}
      {permission !== 'granted' && permission !== 'unsupported' ? <button type="button" onClick={enableNotifications}><span aria-hidden="true">◉</span> Alerts</button> : null}
      <Link href="/notifications" aria-label={`${unreadCount} unread notifications`}><span aria-hidden="true">♢</span>{unreadCount > 0 ? <strong>{Math.min(99, unreadCount)}</strong> : null}</Link>
    </div>
    {status ? <button className="pwa-status-toast" type="button" onClick={() => setStatus('')} role="status">{status}<span aria-hidden="true">×</span></button> : null}
  </>
}
