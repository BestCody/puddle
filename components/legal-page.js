import legalStyles from "@/components/legal.module.css"
import { scopedClasses } from "@/components/scoped-classes"
import Link from 'next/link'
import { PuddleLogo } from './puddle-logo'

export function LegalPage({ eyebrow, title, summary, updated, companionHref, companionLabel, children }) {
  return (
    <main className={scopedClasses(legalStyles, "legal-page")}>
      <header className={scopedClasses(legalStyles, "legal-header")}>
        <PuddleLogo />
        <Link className={scopedClasses(legalStyles, "legal-home-link")} href="/">← Back to home</Link>
      </header>

      <article className={scopedClasses(legalStyles, "legal-document")}>
        <div className={scopedClasses(legalStyles, "legal-hero")}>
          <span className={scopedClasses(legalStyles, "legal-eyebrow")}>{eyebrow}</span>
          <h1>{title}</h1>
          <p className={scopedClasses(legalStyles, "legal-summary")}>{summary}</p>
          <p className={scopedClasses(legalStyles, "legal-updated")}>Last updated: {updated}</p>
        </div>

        <nav className={scopedClasses(legalStyles, "legal-jump")} aria-label="Legal document navigation">
          <Link href={companionHref}>{companionLabel}</Link>
          <Link href="/">Home</Link>
        </nav>

        <div className={scopedClasses(legalStyles, "legal-content")}>{children}</div>

        <footer className={scopedClasses(legalStyles, "legal-footer")}>
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
    <section className={scopedClasses(legalStyles, "legal-section")} id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  )
}
