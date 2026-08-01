"use client"

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DateLocationCard } from '@/components/date-swipe-workspace'
import { csrfFetch } from '@/lib/security/csrf-client'
import { shouldPromptDateFeedback } from '@/lib/app/date-match-rules'

function vibrate(pattern) { try { navigator.vibrate?.(pattern) } catch {} }

async function shareDateMatch(url, title = 'Swipe this date deck with me') {
  if (navigator.share) {
    await navigator.share({ title: 'Puddle DateMatch', text: title, url })
    return 'Invitation shared.'
  }
  await navigator.clipboard.writeText(url)
  return 'Invitation link copied.'
}

function ChoiceNoteModal({ pending, onCancel, onSubmit, busy }) {
  const [note, setNote] = useState(pending?.item?.own_note || '')
  if (!pending) return null
  const perfect = pending.choice === 'perfect'
  return <div className="date-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}>
    <section className="date-choice-sheet" role="dialog" aria-modal="true" aria-labelledby="date-choice-title">
      <span className={`date-choice-icon ${perfect ? 'is-perfect' : ''}`} aria-hidden="true">{perfect ? '★' : '♡'}</span>
      <span className="section-pill">{perfect ? 'Perfect Pick' : 'Save this idea'}</span>
      <h2 id="date-choice-title">Why do you like {pending.item.title}?</h2>
      <p>Your note stays private unless this location becomes a mutual DateMatch.</p>
      <textarea autoFocus value={note} maxLength={280} onChange={(event) => setNote(event.target.value)} placeholder="Looks cozy, close to us, and easy to talk…" />
      <small>{note.length}/280</small>
      <div className="date-choice-actions"><button type="button" onClick={onCancel} disabled={busy}>Cancel</button><button className={perfect ? 'is-perfect' : ''} type="button" onClick={() => onSubmit(note)} disabled={busy}>{busy ? 'Saving…' : perfect ? 'Make it my Perfect Pick' : 'Save choice'}</button></div>
    </section>
  </div>
}

function MatchCelebration({ match, onClose, onPlan }) {
  if (!match) return null
  return <div className="date-match-celebration" role="dialog" aria-modal="true" aria-labelledby="date-match-title">
    <div className="date-match-burst" aria-hidden="true"><span>♡</span><span>★</span><span>♡</span><span>✦</span></div>
    <section>
      <span className="section-pill">It’s a DateMatch</span>
      <h2 id="date-match-title">You both saved {match.item.title}</h2>
      <p>{match.partnerNote ? `Their note: “${match.partnerNote}”` : 'You independently chose the same place.'}</p>
      {match.strength >= 3 ? <strong>At least one of you marked this as a Perfect Pick.</strong> : null}
      <div><button type="button" onClick={() => onPlan(match)}>Plan this date</button><Link href={match.item.href}>View details</Link><button type="button" onClick={onClose}>Keep swiping</button></div>
    </section>
  </div>
}

function ScheduleModal({ target, onClose, onSave, busy }) {
  const [plannedFor, setPlannedFor] = useState('')
  if (!target) return null
  return <div className="date-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="date-choice-sheet" role="dialog" aria-modal="true" aria-labelledby="date-plan-title">
      <span className="section-pill">Make it real</span><h2 id="date-plan-title">Plan {target.item.title}</h2><p>Pick a time for the date. Both people will see it in this DateMatch room.</p>
      <label>When?<input type="datetime-local" value={plannedFor} onChange={(event) => setPlannedFor(event.target.value)} /></label>
      <div className="date-choice-actions"><button type="button" onClick={onClose} disabled={busy}>Not now</button><button type="button" onClick={() => onSave(plannedFor)} disabled={busy || !plannedFor}>{busy ? 'Planning…' : 'Set date and time'}</button></div>
    </section>
  </div>
}

function FeedbackPrompt({ item, onFeedback, busy }) {
  const [happened, setHappened] = useState(null)
  if (happened === null) return <article className="date-feedback-card"><span className="section-pill">Quick follow-up</span><h3>Did you go to {item.title}?</h3><div><button type="button" onClick={() => setHappened(true)}>Yes</button><button type="button" onClick={() => onFeedback(false, null)} disabled={busy}>Not yet</button></div></article>
  return <article className="date-feedback-card"><span className="section-pill">Help the next deck</span><h3>Was it a good date location?</h3><div><button type="button" onClick={() => onFeedback(true, 'great')} disabled={busy}>Great</button><button type="button" onClick={() => onFeedback(true, 'okay')} disabled={busy}>Okay</button><button type="button" onClick={() => onFeedback(true, 'not_for_us')} disabled={busy}>Not for us</button></div></article>
}

function DateMatchSummary({ items, matches, partnerJoined, shareUrl, onPlan, onFeedback, busy }) {
  const itemMap = new Map(items.map((item) => [item.content_id, item]))
  const ranked = [...matches].sort((a, b) => Number(b.strength || 0) - Number(a.strength || 0) || new Date(a.matched_at || 0) - new Date(b.matched_at || 0))
  const top = ranked.slice(0, 3).map((match) => ({ match, item: itemMap.get(match.location_id) })).filter((entry) => entry.item)
  const feedbackTarget = ranked.find((match) => shouldPromptDateFeedback(match))
  const feedbackItem = feedbackTarget ? itemMap.get(feedbackTarget.location_id) : null
  return <section className="date-deck-summary">
    <span className="section-pill">Your best date options</span>
    <h2>{top.length ? 'You found places you both want.' : partnerJoined ? 'No mutual picks yet.' : 'Your choices are saved privately.'}</h2>
    <p>{top.length ? 'Compare the strongest matches, choose one, and turn the swipe momentum into a real plan.' : partnerJoined ? 'You can start another curated deck together without forcing a weak choice.' : 'Send the invitation so your date can independently swipe the same twelve ideas.'}</p>
    {top.length ? <div className="date-summary-grid">{top.map(({ match, item }) => <article key={item.content_id}><span>{match.strength >= 3 ? '★ Perfect overlap' : '♡ Mutual save'}</span><h3>{item.title}</h3><dl><div><dt>Cost</dt><dd>{item.priceLabel}</dd></div><div><dt>Distance</dt><dd>{item.distanceLabel}</dd></div><div><dt>Best for</dt><dd>{item.puddle_pick_reasons?.[0] || 'A date you both chose'}</dd></div></dl>{match.planned_for ? <p className="date-planned-time">Planned for {new Date(match.planned_for).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p> : <button type="button" onClick={() => onPlan({ match, item })}>Plan this date</button>}<Link href={item.href}>View place →</Link></article>)}</div> : null}
    <div className="date-summary-actions"><button type="button" onClick={() => shareDateMatch(shareUrl).catch(() => {})}>Send this deck to my date</button><Link href="/discover">Start another deck</Link></div>
    {feedbackTarget && feedbackItem ? <FeedbackPrompt item={feedbackItem} busy={busy} onFeedback={(happened, rating) => onFeedback(feedbackTarget, happened, rating)} /> : null}
  </section>
}

export function DateMatchWorkspace({ initialSnapshot, googleMapsBrowserKey = '' }) {
  const initialChoices = Object.fromEntries(initialSnapshot.items.filter((item) => item.own_choice).map((item) => [item.content_id, { choice: item.own_choice, note: item.own_note }]))
  const firstUnswiped = initialSnapshot.items.findIndex((item) => !item.own_choice)
  const seenMatches = useRef(new Set((initialSnapshot.matches || []).map((match) => match.location_id)))
  const [items, setItems] = useState(initialSnapshot.items)
  const [matches, setMatches] = useState(initialSnapshot.matches || [])
  const [partnerJoined, setPartnerJoined] = useState(Boolean(initialSnapshot.deck.partnerJoined))
  const [choices, setChoices] = useState(initialChoices)
  const [index, setIndex] = useState(firstUnswiped < 0 ? initialSnapshot.items.length : firstUnswiped)
  const [pendingChoice, setPendingChoice] = useState(null)
  const [celebration, setCelebration] = useState(null)
  const [scheduleTarget, setScheduleTarget] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const current = items[index] || null
  const positiveCount = useMemo(() => Object.values(choices).filter((entry) => entry.choice === 'save' || entry.choice === 'perfect').length, [choices])
  const shareUrl = typeof window === 'undefined' ? '' : window.location.href

  useEffect(() => {
    let cancelled = false
    async function refreshRoom() {
      if (document.hidden) return
      const response = await fetch(`/api/date-match/${encodeURIComponent(initialSnapshot.token)}`, { cache: 'no-store' })
      if (!response.ok || cancelled) return
      const snapshot = await response.json().catch(() => null)
      if (!snapshot || cancelled) return
      setPartnerJoined((previous) => {
        if (!previous && snapshot.deck?.partnerJoined) setMessage('Your date joined the deck. Mutual picks will now appear for both of you.')
        return Boolean(snapshot.deck?.partnerJoined)
      })
      setItems(snapshot.items || [])
      setChoices(Object.fromEntries((snapshot.items || []).filter((item) => item.own_choice).map((item) => [item.content_id, { choice: item.own_choice, note: item.own_note }])))
      const refreshedMatches = snapshot.matches || []
      const newMatch = refreshedMatches.find((match) => !seenMatches.current.has(match.location_id))
      refreshedMatches.forEach((match) => seenMatches.current.add(match.location_id))
      setMatches(refreshedMatches)
      if (newMatch) {
        const matchedItem = (snapshot.items || []).find((item) => item.content_id === newMatch.location_id)
        if (matchedItem) {
          vibrate([40, 35, 80])
          setCelebration({ item: matchedItem, strength: newMatch.strength || 2, partnerNote: matchedItem.partner_note || null })
        }
      }
    }
    const interval = window.setInterval(refreshRoom, 7000)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [initialSnapshot.token])

  function nextUnswiped(afterIndex, nextChoices) {
    for (let offset = 1; offset <= items.length; offset += 1) {
      const candidateIndex = (afterIndex + offset) % items.length
      if (!nextChoices[items[candidateIndex].content_id]) return candidateIndex
    }
    return items.length
  }

  async function persistSwipe(choice, item, note = '') {
    setBusy(true)
    const response = await csrfFetch('/api/date-match/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'swipe', deckId: initialSnapshot.deck.id, locationId: item.content_id, choice, note }) })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) { setMessage(payload.error || 'That choice could not be saved.'); setBusy(false); return }
    const nextChoices = { ...choices, [item.content_id]: { choice, note } }
    setChoices(nextChoices)
    setItems((currentItems) => currentItems.map((candidate) => candidate.content_id === item.content_id ? { ...candidate, own_choice: choice, own_note: note, partner_note: payload.result?.partnerNote || candidate.partner_note } : candidate))
    if (payload.result?.matched) {
      const match = { location_id: item.content_id, strength: payload.result.strength || 2, status: 'matched', matched_at: new Date().toISOString() }
      seenMatches.current.add(item.content_id)
      setMatches((currentMatches) => [...currentMatches.filter((candidate) => candidate.location_id !== item.content_id), match])
      vibrate([40, 35, 80])
      setCelebration({ item, strength: match.strength, partnerNote: payload.result.partnerNote || null })
    }
    setIndex(nextUnswiped(index, nextChoices))
    setMessage(choice === 'perfect' ? `Perfect Pick · ${item.title}` : choice === 'save' ? `Saved privately · ${item.title}` : `Passed · ${item.title}`)
    setPendingChoice(null)
    setBusy(false)
  }

  function requestChoice(choice, item) { if (choice === 'save' || choice === 'perfect') setPendingChoice({ choice, item }); else persistSwipe('pass', item) }
  async function shareRoom() { try { setMessage(await shareDateMatch(window.location.href)) } catch (error) { if (error?.name !== 'AbortError') setMessage('The invitation could not be shared from this browser.') } }

  async function schedule(plannedFor) {
    if (!scheduleTarget) return
    setBusy(true)
    const item = scheduleTarget.item
    const response = await csrfFetch('/api/date-match/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'schedule', deckId: initialSnapshot.deck.id, locationId: item.content_id, plannedFor }) })
    const payload = await response.json().catch(() => ({}))
    if (response.ok) {
      const iso = payload.result?.plannedFor || new Date(plannedFor).toISOString()
      setMatches((currentMatches) => currentMatches.map((candidate) => candidate.location_id === item.content_id ? { ...candidate, planned_for: iso, status: 'planned' } : candidate))
      setMessage(`Date planned · ${item.title}`)
      setScheduleTarget(null)
      setCelebration(null)
    } else setMessage(payload.error || 'That date could not be planned.')
    setBusy(false)
  }

  async function feedback(match, happened, rating) {
    setBusy(true)
    const response = await csrfFetch('/api/date-match/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'feedback', deckId: initialSnapshot.deck.id, locationId: match.location_id, happened, rating }) })
    const payload = await response.json().catch(() => ({}))
    if (response.ok) {
      setMatches((currentMatches) => currentMatches.map((candidate) => candidate.location_id === match.location_id ? { ...candidate, feedback: { happened, rating }, status: happened ? 'happened' : candidate.status } : candidate))
      setMessage(happened ? 'Thanks—your next deck can learn from the real date.' : 'Kept on your shortlist for later.')
    } else setMessage(payload.error || 'That feedback could not be saved.')
    setBusy(false)
  }

  return <div className="date-swipe-workspace date-match-workspace">
    <div className="date-swipe-toolbar"><button className="date-filter-toggle date-swipe-together" type="button" onClick={shareRoom}>↗ Share invitation</button><span>{Math.min(Object.keys(choices).length + 1, items.length)} of {items.length} date ideas</span><Link href="/plans?tab=shared">Open shared plans →</Link></div>
    {!partnerJoined ? <div className="date-match-waiting"><strong>Your date has not joined yet.</strong><span>You can swipe now; your choices remain hidden until they choose the same place.</span><button type="button" onClick={shareRoom}>Send invitation</button></div> : null}
    {positiveCount >= 4 && current ? <p className="date-swipe-message">You already have enough strong choices for a great shortlist.</p> : null}
    {message ? <p className="date-swipe-message" role="status">{message}</p> : null}
    <div className={`date-deck-stage ${current && index < items.length - 1 ? 'has-next-card' : ''}`}>{current ? <DateLocationCard key={current.content_id} item={current} onChoice={requestChoice} onMessage={setMessage} busy={busy} googleMapsBrowserKey={googleMapsBrowserKey} allowPerfect puddlePick={current.is_puddle_pick} partnerNote={current.partner_note} /> : <DateMatchSummary items={items} matches={matches} partnerJoined={partnerJoined} shareUrl={shareUrl} onPlan={setScheduleTarget} onFeedback={feedback} busy={busy} />}</div>
    {current ? <div className="date-deck-footer"><span>Swipe left to pass, right to save, or up for details.</span><span>{positiveCount} strong choice{positiveCount === 1 ? '' : 's'}</span></div> : null}
    <ChoiceNoteModal key={`${pendingChoice?.item?.content_id || 'none'}:${pendingChoice?.choice || ''}`} pending={pendingChoice} busy={busy} onCancel={() => setPendingChoice(null)} onSubmit={(note) => persistSwipe(pendingChoice.choice, pendingChoice.item, note)} />
    <MatchCelebration match={celebration} onClose={() => setCelebration(null)} onPlan={(target) => setScheduleTarget({ ...target, match: matches.find((candidate) => candidate.location_id === target.item.content_id) || target })} />
    <ScheduleModal key={scheduleTarget?.item?.content_id || 'none'} target={scheduleTarget} busy={busy} onClose={() => setScheduleTarget(null)} onSave={schedule} />
  </div>
}
