"use client"

import { useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function MessagesRealtimeBridge({ profileId, conversationId }) {
  const client = useMemo(() => createClient(), [])
  const router = useRouter()
  const refreshTimer = useRef(null)

  useEffect(() => {
    if (!profileId) return

    function queueRefresh() {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => {
        router.refresh()
      }, 80)
    }

    const channel = client
      .channel(`messages-page-sync-${profileId}-${conversationId || 'none'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, queueRefresh)
      .subscribe()

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      client.removeChannel(channel)
    }
  }, [client, router, profileId, conversationId])

  return null
}
