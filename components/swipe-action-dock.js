"use client"

import { useRouter } from 'next/navigation'

function UndoIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5"/><path d="M5 12h8a6 6 0 0 1 6 6"/></svg>
}
function PassIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
}
function SaveIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.6c0 5-8.8 10.4-8.8 10.4S3.2 13.6 3.2 8.6A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8.8 1.9Z"/></svg>
}
function PostIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 12h10M12 7v10"/></svg>
}

const actions = [
  { key: 'undo', label: 'Undo', Icon: UndoIcon },
  { key: 'pass', label: 'Pass', Icon: PassIcon },
  { key: 'save', label: 'Save', Icon: SaveIcon },
  { key: 'perfect', label: 'Post', Icon: PostIcon }
]

export function SwipeActionDock({ onUndo, onPass, onSave, onPerfect, canUndo, busy }) {
  const router = useRouter()
  const handlers = { undo: onUndo, pass: onPass, save: onSave, perfect: onPerfect }

  function runAction(key, event) {
    if (key === 'perfect') {
      const workspace = event.currentTarget.closest('.figma-swipe-workspace')
      const activeCard = workspace?.querySelector('.figma-swipe-card[data-location-id]')
      const locationId = activeCard?.dataset?.locationId
      if (locationId) {
        router.push(`/create/post?location=${encodeURIComponent(locationId)}&source=swipe`)
        return
      }
    }
    handlers[key]?.()
  }

  return <div className="figma-swipe-actions" aria-label="Swipe controls">
    {actions.map(({ key, label, Icon }) => <button
      className={`figma-swipe-action is-${key}`}
      type="button"
      onClick={(event) => runAction(key, event)}
      disabled={busy || (key === 'undo' && !canUndo)}
      aria-label={label}
      key={key}
    >
      <span><Icon /></span>
      <small>{label}</small>
    </button>)}
  </div>
}
