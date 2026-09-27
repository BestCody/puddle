"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { PassNotificationAlerts, PERMISSION_EVENT } from './pass-notification-alerts'

export function DashboardRuntime({ profileId }) {
  const client = useMemo(() => createClient(), [])
  const [bootstrap, setBootstrap] = useState(null)
  const notificationsLink = useRef(null)

  useEffect(() => {
    let active = true
    let loading = false
    let loaded = false
    const menu = notificationsLink.current?.closest('details')

    async function loadBootstrap() {
      if (!active || loading || loaded) return
      loading = true
      try {
        const { data, error } = await client.rpc('dashboard_bootstrap_v1')
        if (!active || error) return
        loaded = true
        setBootstrap({
          showAdmin: Boolean(data?.show_admin),
          unreadNotifications: Number(data?.unread_notifications || 0),
          passActive: Boolean(data?.pass_active)
        })
      } catch {
        // A later menu open or permission change may retry the read.
      } finally {
        loading = false
      }
    }

    function onMenuToggle() {
      if (menu?.open) loadBootstrap()
    }

    function onPermissionChange() {
      if (window.Notification?.permission === 'granted') loadBootstrap()
    }

    menu?.addEventListener('toggle', onMenuToggle)
    window.addEventListener(PERMISSION_EVENT, onPermissionChange)
    if (menu?.open || window.Notification?.permission === 'granted') loadBootstrap()

    return () => {
      active = false
      menu?.removeEventListener('toggle', onMenuToggle)
      window.removeEventListener(PERMISSION_EVENT, onPermissionChange)
    }
  }, [client])

  return <>
    <PassNotificationAlerts enabled={Boolean(bootstrap?.passActive)} profileId={profileId} />
    <Link ref={notificationsLink} href="/account?section=notifications&returnTo=%2Fdiscover">
      Notifications{bootstrap?.unreadNotifications ? ` (${bootstrap.unreadNotifications})` : ''}
    </Link>
    {bootstrap?.showAdmin ? <Link href="/admin">Admin</Link> : null}
  </>
}
