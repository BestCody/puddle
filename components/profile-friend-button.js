"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function ProfileFriendButton({ friendId, name }) {
  const router = useRouter()
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')

  async function openConversation() {
    if (opening) return
    setOpening(true)
    setError('')
    try {
      const { data, error: openError } = await createClient().rpc('social_open_direct_conversation_v1', { target: friendId })
      if (openError || !data) throw openError || new Error('Conversation unavailable')
      router.push(`/matches?tab=messages&conversation=${encodeURIComponent(data)}`)
    } catch {
      setError(`Could not open the conversation with ${name}. Try again.`)
      setOpening(false)
    }
  }

  return <>
    <button type="button" onClick={openConversation} disabled={opening} aria-label={`Message ${name}`}>
      <span>{opening ? 'Opening conversation…' : name}</span>
    </button>
    {error ? <small role="alert">{error}</small> : null}
  </>
}
