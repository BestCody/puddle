"use client"

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

const PERMISSION_EVENT = 'puddle:notification-permission'

function permissionState() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return window.Notification.permission
}

export function PassNotificationAlerts({ enabled, profileId }) {
  const client = useMemo(() => createClient(), [])
  const [permission, setPermission] = useState('default')

  useEffect(() => {
    function syncPermission() { setPermission(permissionState()) }
    syncPermission()
    window.addEventListener(PERMISSION_EVENT, syncPermission)
    return () => window.removeEventListener(PERMISSION_EVENT, syncPermission)
  }, [])

  useEffect(() => {
    if (!enabled || !profileId || permission !== 'granted') return undefined

    const channel = client
      .channel(`pass-notification-alerts:${profileId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `profile_id=eq.${profileId}`
      }, (event) => {
        const item = event.new || {}
        if (permissionState() !== 'granted') return
        const alert = new window.Notification(item.title || 'Puddle', {
          body: item.body || '',
          tag: `puddle-notification-${item.id || Date.now()}`,
          icon: '/puddle-mark.svg'
        })
        alert.onclick = () => {
          window.focus()
          const href = String(item.href || '')
          if (href.startsWith('/') && !href.startsWith('//')) window.location.assign(href)
          alert.close()
        }
      })
      .subscribe()

    return () => { client.removeChannel(channel) }
  }, [client, enabled, permission, profileId])

  return null
}

export function PassNotificationAlertControl({ enabled }) {
  const [permission, setPermission] = useState('default')

  useEffect(() => setPermission(permissionState()), [])

  async function enableAlerts() {
    if (!enabled || permissionState() === 'unsupported') return
    const next = await window.Notification.requestPermission()
    setPermission(next)
    window.dispatchEvent(new Event(PERMISSION_EVENT))
  }

  if (!enabled) return <section className="pass-notification-alert-control is-locked">
    <span>PASS</span>
    <div><strong>Notification alerts</strong><p>Browser and desktop alerts are included with Puddle Pass.</p></div>
    <Link href="/membership">View Pass</Link>
  </section>

  return <section className="pass-notification-alert-control">
    <span>PASS</span>
    <div><strong>Notification alerts</strong><p>Get browser or desktop alerts for enabled Puddle notifications while Puddle is open.</p></div>
    {permission === 'granted' ? <b>Enabled</b>
      : permission === 'denied' ? <b>Blocked in browser</b>
        : permission === 'unsupported' ? <b>Not supported</b>
          : <button type="button" onClick={enableAlerts}>Enable alerts</button>}
  </section>
}
