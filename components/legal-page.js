import Link from 'next/link'
import { PuddleLogo } from './puddle-logo'

export function LegalPage({ eyebrow, title, summary, updated, companionHref, companionLabel, children }) {
  return (
    <main className="legal-page">
      <header className="legal-header">
        <PuddleLogo />
        <Link className="legal-home-link" href="/">← Back to home</Link>
      </header>

      <article className="legal-document">
        <div className="legal-hero">
          <span className="legal-eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p className="legal-summary">{summary}</p>
          <p className="legal-updated">Last updated: {updated}</p>
        </div>

        <nav className="legal-jump" aria-label="Legal document navigation">
          <Link href={companionHref}>{companionLabel}</Link>
          <Link href="/">Home</Link>
        </nav>

        <div className="legal-content">{children}</div>

        <footer className="legal-footer">
          <PuddleLogo compact />
          <div>
            <Link href={companionHref}>{companionLabel}</Link>
            <Link href="/">← Back to home</Link>
          </div>
        </footer>
      </article>
    </main>
  )
}

export function LegalSection({ id, title, children }) {
  return (
    <section className="legal-section" id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  )
}
