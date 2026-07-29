"use client"

import { useMemo, useState } from 'react'

function rotate(items, index) {
  return items[(index + items.length) % items.length]
}

export function DiscoveryDeck({ items }) {
  const safeItems = useMemo(() => items?.length ? items : [], [items])
  const [index, setIndex] = useState(0)
  const [lastAction, setLastAction] = useState('')
  const current = safeItems.length ? rotate(safeItems, index) : null
  const next = safeItems.length > 1 ? rotate(safeItems, index + 1) : null

  function act(action) {
    if (!current) return
    setLastAction(`${action} · ${current.title}`)
    setIndex((value) => value + 1)
  }

  function undo() {
    if (!safeItems.length) return
    setIndex((value) => Math.max(0, value - 1))
    setLastAction('Last choice undone')
  }

  if (!current) return null

  return (
    <div className="deck-wrap">
      <div className="deck-stack" aria-live="polite">
        {next ? <article className="discovery-card discovery-card-back" aria-hidden="true" style={{ '--card-accent': next.accent }} /> : null}
        <article className="discovery-card" style={{ '--card-accent': current.accent }}>
          <div className="discovery-art">
            <span className="content-kind">{current.kind}</span>
            <span className="vibe-score">{current.badge}</span>
            <div className="discovery-art-symbol" aria-hidden="true">{current.symbol}</div>
          </div>
          <div className="discovery-card-copy">
            <div className="card-kicker"><span>{current.category}</span><span>{current.distance}</span></div>
            <h2>{current.title}</h2>
            <p>{current.meta}</p>
            <div className="card-tags">{current.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          </div>
        </article>
      </div>
      <div className="deck-actions" aria-label="Discovery actions">
        <button type="button" onClick={undo} aria-label="Undo">↶</button>
        <button className="action-no" type="button" onClick={() => act('Passed')} aria-label="Not for me">×</button>
        <button className="action-save" type="button" onClick={() => act('Saved')} aria-label="Save">♡</button>
        <button className="action-yes" type="button" onClick={() => act('Interested')} aria-label="Interested">✦</button>
      </div>
      <p className="deck-status">{lastAction || 'Swipe with the buttons—events and places share one playful deck.'}</p>
    </div>
  )
}
