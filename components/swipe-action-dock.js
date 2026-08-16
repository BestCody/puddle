"use client"

function UndoIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 7-5 5 5 5"/><path d="M5 12h12"/></svg>
}
function PassIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
}
function SaveIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.6c0 5-8.8 10.4-8.8 10.4S3.2 13.6 3.2 8.6A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8.8 1.9Z"/></svg>
}
function PerfectIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/></svg>
}

const actions = [
  { key: 'undo', label: 'Back', Icon: UndoIcon },
  { key: 'pass', label: 'Pass', Icon: PassIcon },
  { key: 'save', label: 'Save', Icon: SaveIcon },
  { key: 'perfect', label: 'Star', Icon: PerfectIcon }
]

export function SwipeActionDock({ onUndo, onPass, onSave, onPerfect, canUndo, busy }) {
  const handlers = { undo: onUndo, pass: onPass, save: onSave, perfect: onPerfect }
  return <div className="figma-swipe-actions" aria-label="Swipe controls">
    {actions.map(({ key, label, Icon }) => <button
      className={`figma-swipe-action is-${key}`}
      type="button"
      onClick={handlers[key]}
      disabled={busy || (key === 'undo' && !canUndo)}
      aria-label={label}
      key={key}
    >
      <span><Icon /></span>
      <small>{label}</small>
    </button>)}
  </div>
}