import Link from 'next/link'
import { PuddleLogo } from './puddle-logo'

export function AuthShell({ eyebrow, title, description, children, asideTitle = 'Plans are better together.', asideText = 'Find the event, meet your people, and turn “we should hang out” into an actual plan.' }) {
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="auth-links" style={{ marginTop: 0, alignItems: 'center' }}>
          <PuddleLogo />
          <Link href="/" aria-label="Back to Puddle home">← Back to home</Link>
        </div>
        <div className="auth-copy">
          <span className="auth-eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {children}
      </section>
      <aside className="auth-art" aria-hidden="true">
        <div className="auth-blob auth-blob-one" />
        <div className="auth-blob auth-blob-two" />
        <div className="auth-sticker">tonight?</div>
        <div className="auth-event-card auth-event-back"><span>ART</span><strong>Midnight museum</strong></div>
        <div className="auth-event-card auth-event-front"><span>MUSIC</span><strong>Neon Garden</strong><small>Fri · 10 PM</small></div>
        <div className="auth-art-copy"><h2>{asideTitle}</h2><p>{asideText}</p></div>
      </aside>
    </main>
  )
}
