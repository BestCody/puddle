"use client"

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function PassMessageSearch({ enabled }) {
  const router = useRouter()
  const client = useMemo(() => createClient(), [])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  if (!enabled) return null

  async function search(event) {
    event.preventDefault()
    const term = query.trim()
    if (!term) return setResults([])
    setBusy(true)
    setNotice('')
    const { data, error } = await client.rpc('pass_message_search_v2', { search_term: term, result_limit: 30 })
    setResults(error ? [] : data || [])
    if (error) setNotice('Could not search profiles right now.')
    setBusy(false)
  }

  async function message(person) {
    if (!person?.can_message || busy) return
    setBusy(true)
    setNotice('')
    const { data, error } = await client.rpc('pass_open_direct_conversation_v1', { target: person.id })
    if (error || !data) {
      setNotice('That profile is not available for messaging.')
      setBusy(false)
      return
    }
    router.push(`/matches?tab=messages&conversation=${encodeURIComponent(data)}`)
  }

  return <section className="pass-message-anyone" aria-label="Pass message anyone">
    <div className="pass-message-anyone-heading"><span>PASS</span><div><strong>Message anyone</strong><small>Search adult Puddle profiles outside your friends list.</small></div></div>
    <form onSubmit={search}>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or @username" maxLength={60} aria-label="Search profiles to message" />
      <button type="submit" disabled={busy || !query.trim()}>Search</button>
    </form>
    {notice ? <p role="status">{notice}</p> : null}
    {results.length ? <div className="pass-message-anyone-results">{results.map((person) => <div key={person.id}>
      <span><strong>{person.display_name || person.username || 'Puddle person'}</strong>{person.username ? <small>@{person.username}</small> : null}</span>
      <button type="button" onClick={() => message(person)} disabled={busy || !person.can_message}>Message</button>
    </div>)}</div> : null}
  </section>
}
