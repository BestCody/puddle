"use client"

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DateLocationCard } from '@/components/date-swipe-workspace'
import { SwipeActionDock } from '@/components/swipe-action-dock'
import { csrfFetch } from '@/lib/security/csrf-client'
import { shouldPromptDateFeedback } from '@/lib/app/date-match-rules'

function vibrate(pattern) { try { navigator.vibrate?.(pattern) } catch {} }

async function shareRoom(url, mode) {
  const group = mode === 'hangout'
  const title = group ? 'Join my Puddle Hangout Match' : 'Swipe this date deck with me'
  const text = group ? 'Privately choose hangout locations with us and reveal the places the group agrees on.' : 'Privately choose date locations with me and reveal only our mutual picks.'
  if (navigator.share) {
    await navigator.share({ title, text, url })
    return 'Invitation shared.'
  }
  await navigator.clipboard.writeText(url)
  return 'Invitation link copied.'
}

function ChoiceNoteModal({ pending, onCancel, onSubmit, busy, mode }) {
  const [note, setNote] = useState(pending?.item?.own_note || '')
  if (!pending) return null
  const perfect = pending.choice === 'perfect'
  const group = mode === 'hangout'
  return <div className="date-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}>
    <section className="date-choice-sheet" role="dialog" aria-modal="true" aria-labelledby="date-choice-title">
      <span className={`date-choice-icon ${perfect ? 'is-perfect' : ''}`} aria-hidden="true">{perfect ? '★' : '♡'}</span>
      <span className="section-pill">{perfect ? 'Perfect Pick' : 'Save this idea'}</span>
      <h2 id="date-choice-title">Why does {pending.item.title} work?</h2>
      <p>Your note stays private unless this becomes {group ? 'a group match' : 'a mutual DateMatch'}.</p>
      <textarea autoFocus value={note} maxLength={280} onChange={(event) => setNote(event.target.value)} placeholder={group ? 'Good for everyone, easy transit, enough room…' : 'Looks cozy, close to us, and easy to talk…'} />
      <small>{note.length}/280</small>
      <div className="date-choice-actions"><button type="button" onClick={onCancel} disabled={busy}>Cancel</button><button className={perfect ? 'is-perfect' : ''} type="button" onClick={() => onSubmit(note)} disabled={busy}>{busy ? 'Saving…' : perfect ? 'Make it my Perfect Pick' : 'Save choice'}</button></div>
    </section>
  </div>
}

function MatchCelebration({ match, mode, onClose, onPlan }) {
  if (!match) return null
  const group = mode === 'hangout'
  const summary = match.voteSummary || match.item.group_choice_summary || {}
  return <div className="date-match-celebration" role="dialog" aria-modal="true" aria-labelledby="date-match-title">
    <div className="date-match-burst" aria-hidden="true"><span>♡</span><span>★</span><span>♡</span><span>✦</span></div>
    <section>
      <span className="section-pill">{group ? 'Group match found' : 'It’s a DateMatch'}</span>
      <h2 id="date-match-title">{group ? `Your group agrees on ${match.item.title}` : `You both saved ${match.item.title}`}</h2>
      <p>{group ? `${summary.positiveCount || 2} people chose this location with no vetoes.` : match.item.partner_note ? `Their note: “${match.item.partner_note}”` : 'You independently chose the same place.'}</p>
      {(summary.perfectCount || match.strength >= 3) ? <strong>{group ? `${summary.perfectCount || 1} Perfect Pick${Number(summary.perfectCount || 1) === 1 ? '' : 's'} made this match stronger.` : 'At least one of you marked this as a Perfect Pick.'}</strong> : null}
      <div><button type="button" onClick={() => onPlan(match)}>Plan this {group ? 'hangout' : 'date'}</button><Link href={match.item.href}>View details</Link><button type="button" onClick={onClose}>Keep swiping</button></div>
    </section>
  </div>
}

function ScheduleModal({ target, onClose, onSave, busy, mode }) {
  const [plannedFor, setPlannedFor] = useState('')
  if (!target) return null
  const group = mode === 'hangout'
  return <div className="date-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="date-choice-sheet" role="dialog" aria-modal="true" aria-labelledby="date-plan-title">
      <span className="section-pill">Make it real</span><h2 id="date-plan-title">Plan {target.item.title}</h2><p>Pick a time. {group ? 'Everyone in the room' : 'Both people'} will see it here and in Planned.</p>
      <label>When?<input type="datetime-local" value={plannedFor} onChange={(event) => setPlannedFor(event.target.value)} /></label>
      <div className="date-choice-actions"><button type="button" onClick={onClose} disabled={busy}>Not now</button><button type="button" onClick={() => onSave(plannedFor)} disabled={busy || !plannedFor}>{busy ? 'Planning…' : 'Set date and time'}</button></div>
    </section>
  </div>
}

function FeedbackPrompt({ item, onFeedback, busy, mode }) {
  const [happened, setHappened] = useState(null)
  const noun = mode === 'hangout' ? 'hangout' : 'date'
  if (happened === null) return <article className="date-feedback-card"><span className="section-pill">Quick follow-up</span><h3>Did the {noun} at {item.title} happen?</h3><div><button type="button" onClick={() => setHappened(true)}>Yes</button><button type="button" onClick={() => onFeedback(false, null)} disabled={busy}>Not yet</button></div></article>
  return <article className="date-feedback-card"><span className="section-pill">Help the next deck</span><h3>How well did this location work?</h3><div><button type="button" onClick={() => onFeedback(true, 'great')} disabled={busy}>Great</button><button type="button" onClick={() => onFeedback(true, 'okay')} disabled={busy}>Okay</button><button type="button" onClick={() => onFeedback(true, 'not_for_us')} disabled={busy}>Not for us</button></div></article>
}

function MemberStrip({ deck }) {
  const group = deck.mode === 'hangout'
  const remaining = Math.max(0, Number(deck.maxMembers || 2) - Number(deck.memberCount || 0))
  return <section className="shared-member-strip" aria-label={group ? 'Hangout Match members' : 'DateMatch members'}>
    <div><span className="section-pill section-pill-mint">{group ? 'Hangout Match' : 'DateMatch'}</span><strong>{deck.memberCount} of {deck.maxMembers} joined</strong><small>{deck.completedCount} finished choosing</small></div>
    <div className="shared-member-chips">{(deck.members || []).map((member) => <span className={member.completed ? 'is-complete' : ''} key={member.profile_id}><i aria-hidden="true">{member.completed ? '✓' : '•'}</i>{member.name}</span>)}{remaining > 0 ? <span className="is-open"><i aria-hidden="true">+</i>{remaining} open</span> : null}</div>
  </section>
}

function RevealedNotes({ notes }) {
  if (!notes?.length) return null
  return <div className="group-revealed-notes">{notes.slice(0, 5).map((note, index) => <blockquote key={`${note.name}:${index}`}><strong>{note.choice === 'perfect' ? '★' : '♥'} {note.name}</strong><p>“{note.note}”</p></blockquote>)}</div>
}

function SharedDeckSummary({ items, matches, deck, shareUrl, onPlan, onFeedback, busy }) {
  const itemMap = new Map(items.map((item) => [item.content_id, item]))
  const ranked = [...matches].sort((a, b) => Number(b.strength || 0) - Number(a.strength || 0) || Number(b.voteSummary?.positiveCount || 0) - Number(a.voteSummary?.positiveCount || 0) || new Date(a.matched_at || 0) - new Date(b.matched_at || 0))
  const top = ranked.slice(0, 4).map((match) => ({ match, item: itemMap.get(match.location_id) })).filter((entry) => entry.item)
  const feedbackTarget = ranked.find((match) => shouldPromptDateFeedback(match))
  const feedbackItem = feedbackTarget ? itemMap.get(feedbackTarget.location_id) : null
  const group = deck.mode === 'hangout'
  return <section className="date-deck-summary shared-deck-summary">
    <span className="section-pill">{group ? 'Your strongest group options' : 'Your best date options'}</span>
    <h2>{top.length ? group ? 'Your group found places that work.' : 'You found places you both want.' : deck.memberCount >= 2 ? 'No shared picks yet.' : 'Your choices are saved privately.'}</h2>
    <p>{top.length ? 'Compare the strongest matches, choose one, and turn the swipe momentum into a real plan.' : deck.memberCount >= 2 ? group ? 'A group match needs broad support and no Pass veto. Everyone can keep choosing privately.' : 'You can start another curated deck together without forcing a weak choice.' : `Share the invitation so ${group ? 'your group' : 'the other person'} can independently swipe the same twelve ideas.`}</p>
    {top.length ? <div className="date-summary-grid">{top.map(({ match, item }) => {
      const summary = match.voteSummary || item.group_choice_summary || {}
      return <article key={item.content_id}><span>{summary.perfectCount || match.strength >= 3 ? '★ Perfect overlap' : '♡ Shared save'}</span><h3>{item.title}</h3>{group ? <div className="group-vote-meter"><span style={{ width: `${Math.min(100, Math.round((Number(summary.positiveCount || 0) / Math.max(1, deck.memberCount)) * 100))}%` }} /><small>{summary.positiveCount || 0} positive · {summary.perfectCount || 0} perfect · {summary.passCount || 0} vetoes</small></div> : null}<dl><div><dt>Cost</dt><dd>{item.priceLabel}</dd></div><div><dt>Distance</dt><dd>{item.distanceLabel}</dd></div><div><dt>Best for</dt><dd>{item.puddle_pick_reasons?.[0] || (group ? 'A place the group chose' : 'A date you both chose')}</dd></div></dl><RevealedNotes notes={item.group_notes} />{match.planned_for ? <p className="date-planned-time">Planned for {new Date(match.planned_for).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p> : <button type="button" onClick={() => onPlan({ match, item })}>Plan this {group ? 'hangout' : 'date'}</button>}<Link href={item.href}>View place →</Link></article>
    })}</div> : null}
    <div className="date-summary-actions"><button type="button" onClick={() => shareRoom(shareUrl, deck.mode).catch(() => {})}>{group ? 'Invite more people' : 'Send this deck to my date'}</button><Link href="/discover">Start another deck</Link><Link href="/map">Open saved & matched map</Link></div>
    {feedbackTarget && feedbackItem ? <FeedbackPrompt item={feedbackItem} mode={deck.mode} busy={busy} onFeedback={(happened, rating) => onFeedback(feedbackTarget, happened, rating)} /> : null}
  </section>
}

export function DateMatchWorkspace({ initialSnapshot, googleMapsBrowserKey = '' }) {
  const initialChoices = Object.fromEntries(initialSnapshot.items.filter((item) => item.own_choice).map((item) => [item.content_id, { choice: item.own_choice, note: item.own_note }]))
  const firstUnswiped = initialSnapshot.items.findIndex((item) => !item.own_choice)
  const seenMatches = useRef(new Set((initialSnapshot.matches || []).map((match) => match.location_id)))
  const [items, setItems] = useState(initialSnapshot.items)
  const [matches, setMatches] = useState(initialSnapshot.matches || [])
  const [deck, setDeck] = useState(initialSnapshot.deck)
  const [choices, setChoices] = useState(initialChoices)
  const [index, setIndex] = useState(firstUnswiped < 0 ? initialSnapshot.items.length : firstUnswiped)
  const [pendingChoice, setPendingChoice] = useState(null)
  const [celebration, setCelebration] = useState(null)
  const [scheduleTarget, setScheduleTarget] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionEffect, setActionEffect] = useState(null)
  const current = items[index] || null
  const group = deck.mode === 'hangout'
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
      setDeck((previous) => {
        if (snapshot.deck?.memberCount > previous.memberCount) setMessage(group ? 'Someone joined your Hangout Match.' : 'Your date joined the deck.')
        return snapshot.deck || previous
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
          setCelebration({ match: newMatch, item: matchedItem, strength: newMatch.strength || 2, voteSummary: newMatch.voteSummary || matchedItem.group_choice_summary })
        }
      }
    }
    const interval = window.setInterval(refreshRoom, 7000)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [initialSnapshot.token, group])

  function nextUnswiped(afterIndex, nextChoices) {
    for (let offset = 1; offset <= items.length; offset += 1) {
      const candidateIndex = (afterIndex + offset) % items.length
      if (!nextChoices[items[candidateIndex].content_id]) return candidateIndex
    }
    return items.length
  }

  function flash(action) {
    setActionEffect(action)
    window.setTimeout(() => setActionEffect((value) => value === action ? null : value), 480)
  }

  async function persistSwipe(choice, item, note = '') {
    if (busy) return
    setBusy(true)
    flash(choice)
    const response = await csrfFetch('/api/date-match/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'swipe', deckId: deck.id, locationId: item.content_id, choice, note }) })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) { setMessage(payload.error || 'That choice could not be saved.'); setBusy(false); return }
    const nextChoices = { ...choices, [item.content_id]: { choice, note } }
    setChoices(nextChoices)
    setItems((currentItems) => currentItems.map((candidate) => candidate.content_id === item.content_id ? { ...candidate, own_choice: choice, own_note: note } : candidate))
    setDeck((currentDeck) => ({ ...currentDeck, completedCount: Number(payload.result?.completedMembers ?? currentDeck.completedCount), memberCount: Number(payload.result?.memberCount ?? currentDeck.memberCount) }))
    if (payload.result?.matched) {
      const match = { location_id: item.content_id, strength: payload.result.strength || 2, status: 'matched', matched_at: new Date().toISOString(), voteSummary: { positiveCount: payload.result.positiveCount, perfectCount: payload.result.perfectCount, passCount: payload.result.passCount, voteCount: payload.result.memberCount } }
      seenMatches.current.add(item.content_id)
      setMatches((currentMatches) => [...currentMatches.filter((candidate) => candidate.location_id !== item.content_id), match])
      if (payload.result?.newMatch !== false) {
        vibrate([40, 35, 80])
        setCelebration({ match, item, strength: match.strength, voteSummary: match.voteSummary })
      }
    }
    setIndex(nextUnswiped(index, nextChoices))
    setMessage(choice === 'perfect' ? `Perfect Pick · ${item.title}` : choice === 'save' ? `Saved privately · ${item.title}` : `Passed · ${item.title}`)
    setPendingChoice(null)
    setBusy(false)
  }

  function requestChoice(choice, item) { if (choice === 'save' || choice === 'perfect') setPendingChoice({ choice, item }); else persistSwipe('pass', item) }
  async function shareInvitation() { try { setMessage(await shareRoom(window.location.href, deck.mode)) } catch (error) { if (error?.name !== 'AbortError') setMessage('The invitation could not be shared from this browser.') } }

  async function schedule(plannedFor) {
    if (!scheduleTarget) return
    setBusy(true)
    const item = scheduleTarget.item
    const response = await csrfFetch('/api/date-match/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'schedule', deckId: deck.id, locationId: item.content_id, plannedFor }) })
    const payload = await response.json().catch(() => ({}))
    if (response.ok) {
      const iso = payload.result?.plannedFor || new Date(plannedFor).toISOString()
      setMatches((currentMatches) => currentMatches.map((candidate) => candidate.location_id === item.content_id ? { ...candidate, planned_for: iso, status: 'planned' } : candidate))
      setMessage(`${group ? 'Hangout' : 'Date'} planned · ${item.title}`)
      setScheduleTarget(null)
      setCelebration(null)
    } else setMessage(payload.error || 'That plan could not be saved.')
    setBusy(false)
  }

  async function feedback(match, happened, rating) {
    setBusy(true)
    const response = await csrfFetch('/api/date-match/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'feedback', deckId: deck.id, locationId: match.location_id, happened, rating }) })
    const payload = await response.json().catch(() => ({}))
    if (response.ok) {
      setMatches((currentMatches) => currentMatches.map((candidate) => candidate.location_id === match.location_id ? { ...candidate, feedback: { happened, rating }, status: happened ? 'happened' : candidate.status } : candidate))
      setMessage(happened ? 'Thanks—future decks will learn from the real visit.' : 'Kept on your shortlist for later.')
    } else setMessage(payload.error || 'That feedback could not be saved.')
    setBusy(false)
  }

  return <div className={`date-swipe-workspace date-match-workspace ${group ? 'is-hangout-match' : 'is-date-match'}`}>
    <MemberStrip deck={deck} />
    <div className="date-swipe-toolbar"><button className="date-filter-toggle date-swipe-together" type="button" onClick={shareInvitation}>↗ {group ? 'Invite group' : 'Share invitation'}</button><span>{current ? `${Math.min(Object.keys(choices).length + 1, items.length)} of ${items.length}` : 'Choices complete'}</span><Link href="/plans?tab=planned">Open plans →</Link></div>
    {!deck.isFull ? <div className="date-match-waiting"><strong>{deck.memberCount < 2 ? group ? 'Invite at least one more person.' : 'Your date has not joined yet.' : group ? `There is room for ${deck.maxMembers - deck.memberCount} more.` : 'You are both in.'}</strong><span>Your choices remain private. Notes and votes appear only after a shared match is created.</span><button type="button" onClick={shareInvitation}>{group ? 'Invite people' : 'Send invitation'}</button></div> : null}
    {positiveCount >= 4 && current ? <p className="date-swipe-message">Your private shortlist is already strong. Keep exploring or wait for the others.</p> : null}
    {message ? <p className={`date-swipe-message swipe-v2-toast ${actionEffect ? `is-${actionEffect}` : ''}`} role="status" aria-live="polite">{message}</p> : null}
    <div className={`date-deck-stage ${current && index < items.length - 1 ? 'has-next-card' : ''} ${actionEffect ? `is-${actionEffect}` : ''}`}>
      {current ? <DateLocationCard key={current.content_id} item={current} onChoice={requestChoice} onMessage={setMessage} busy={busy} googleMapsBrowserKey={googleMapsBrowserKey} allowPerfect puddlePick={Boolean(current.is_puddle_pick)} /> : <SharedDeckSummary items={items} matches={matches} deck={deck} shareUrl={shareUrl} onPlan={setScheduleTarget} onFeedback={feedback} busy={busy} />}
    </div>
    {current ? <SwipeActionDock onUndo={() => setMessage('Choices in a shared room can be changed by swiping the card again.')} onPass={() => requestChoice('pass', current)} onSave={() => requestChoice('save', current)} onPerfect={() => requestChoice('perfect', current)} canUndo={false} busy={busy} intent={actionEffect} /> : null}
    <ChoiceNoteModal key={`${pendingChoice?.item?.content_id || 'none'}:${pendingChoice?.choice || ''}`} pending={pendingChoice} onCancel={() => setPendingChoice(null)} onSubmit={(note) => persistSwipe(pendingChoice.choice, pendingChoice.item, note)} busy={busy} mode={deck.mode} />
    <MatchCelebration match={celebration} mode={deck.mode} onClose={() => setCelebration(null)} onPlan={(target) => setScheduleTarget({ match: target.match || target, item: target.item })} />
    <ScheduleModal target={scheduleTarget} onClose={() => setScheduleTarget(null)} onSave={schedule} busy={busy} mode={deck.mode} />
  </div>
}
