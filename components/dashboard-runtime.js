"use client"

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { PassNotificationAlerts } from './pass-notification-alerts'

export function DashboardRuntime({ profileId }) {
  const client = useMemo(() => createClient(), [])
  const [bootstrap, setBootstrap] = useState(null)

  useEffect(() => {
    let active = true
    client.rpc('dashboard_bootstrap_v1').then(({ data, error }) => {
      if (!active || error) return
      setBootstrap({
        showAdmin: Boolean(data?.show_admin),
        unreadNotifications: Number(data?.unread_notifications || 0),
        passActive: Boolean(data?.pass_active)
      })
    })
    return () => { active = false }
  }, [client])

  return <>
    <PassNotificationAlerts enabled={Boolean(bootstrap?.passActive)} profileId={profileId} />
    <Link href="/account?section=notifications&returnTo=%2Fdiscover">
      Notifications{bootstrap?.unreadNotifications ? ` (${bootstrap.unreadNotifications})` : ''}
    </Link>
    {bootstrap?.showAdmin ? <Link href="/admin">Admin</Link> : null}
  </>
}
