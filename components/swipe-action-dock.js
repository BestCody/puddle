"use client"

function UndoIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5"/><path d="M5 12h8a6 6 0 0 1 6 6"/></svg>
}
function PassIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
}
function SaveIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.6c0 5-8.8 10.4-8.8 10.4S3.2 13.6 3.2 8.6A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8.8 1.9Z"/></svg>
}
function StarIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.8 2.6 5.3 5.9.9-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.9L12 3.8Z"/></svg>
}

const actions = [
  { key: 'undo', label: 'Undo', Icon: UndoIcon },
  { key: 'pass', label: 'Pass', Icon: PassIcon },
  { key: 'save', label: 'Save', Icon: SaveIcon },
  { key: 'perfect', label: 'Star', Icon: StarIcon }
]

export function SwipeActionDock({ onUndo, onPass, onSave, onPerfect, canUndo, busy }) {
  const handlers = { undo: onUndo, pass: onPass, save: onSave, perfect: onPerfect }

  function runAction(key) {
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
