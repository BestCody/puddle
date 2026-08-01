"use client"

function UndoIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.4 7.2H4.2V3M4.5 7.1A8.1 8.1 0 1 1 4 16"/><path d="m4.2 7.2 4-4"/></svg>
}

function PassIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
}

function SaveIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.6c0 5-8.8 10.4-8.8 10.4S3.2 13.6 3.2 8.6A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8.8 1.9Z"/></svg>
}

function PerfectIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/><path className="perfect-spark" d="M4 3v3M2.5 4.5h3M20 17v3m-1.5-1.5h3"/></svg>
}

const actions = [
  { key: 'undo', label: 'Undo', hint: 'Bring back the last card', shortcut: 'Z', Icon: UndoIcon },
  { key: 'pass', label: 'Pass', hint: 'Not this one', shortcut: '←', Icon: PassIcon },
  { key: 'save', label: 'Save', hint: 'Add to your shortlist', shortcut: '→', Icon: SaveIcon },
  { key: 'perfect', label: 'Perfect Pick', hint: 'This one stands out', shortcut: 'P', Icon: PerfectIcon }
]

export function SwipeActionDock({ onUndo, onPass, onSave, onPerfect, canUndo, busy, intent = null }) {
  const handlers = { undo: onUndo, pass: onPass, save: onSave, perfect: onPerfect }

  return (
    <section className="swipe-control-wrap" aria-label="Swipe controls">
      <div className="swipe-control-dock">
        {actions.map(({ key, label, hint, shortcut, Icon }) => {
          const disabled = busy || (key === 'undo' && !canUndo)
          return (
            <button
              className={`swipe-control swipe-control-${key} ${intent === key ? 'is-previewing' : ''}`}
              data-action={key}
              type="button"
              onClick={handlers[key]}
              disabled={disabled}
              aria-label={`${label}. ${hint}`}
              aria-keyshortcuts={key === 'undo' ? 'Z U' : key === 'pass' ? 'ArrowLeft' : key === 'save' ? 'ArrowRight' : 'P ArrowUp'}
              key={key}
            >
              <span className="swipe-control-icon"><Icon /></span>
              <span className="swipe-control-copy"><strong>{label}</strong><small>{shortcut}</small></span>
              <span className="swipe-control-tooltip" role="presentation">{hint}</span>
            </button>
          )
        })}
      </div>
      <p className="swipe-control-guide"><span>Drag left to pass</span><span>Drag right to save</span><span>Tap the star for a Perfect Pick</span></p>
    </section>
  )
}
