import authStyles from "@/components/auth.module.css"
import { scopedClasses } from "@/components/scoped-classes"
import Link from 'next/link'
import { PuddleLogo } from './puddle-logo'

export function AuthShell({ eyebrow, title, description, children, asideTitle = 'Plans are better together.', asideText = 'Find the event, meet your people, and turn “we should hang out” into an actual plan.' }) {
  return (
    <main className={scopedClasses(authStyles, "auth-page")}>
      <section className={scopedClasses(authStyles, "auth-panel")}>
        <div className={scopedClasses(authStyles, "auth-links")} style={{ marginTop: 0, alignItems: 'center' }}>
          <PuddleLogo />
          <Link href="/" aria-label="Back to Puddle home">← Back to home</Link>
        </div>
        <div className={scopedClasses(authStyles, "auth-copy")}>
          <span className={scopedClasses(authStyles, "auth-eyebrow")}>{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {children}
      </section>
      <aside className={scopedClasses(authStyles, "auth-art")} aria-hidden="true">
        <div className={scopedClasses(authStyles, "auth-blob auth-blob-one")} />
        <div className={scopedClasses(authStyles, "auth-blob auth-blob-two")} />
        <div className={scopedClasses(authStyles, "auth-sticker")}>tonight?</div>
        <div className={scopedClasses(authStyles, "auth-event-card auth-event-back")}><span>ART</span><strong>Midnight museum</strong></div>
        <div className={scopedClasses(authStyles, "auth-event-card auth-event-front")}><span>MUSIC</span><strong>Neon Garden</strong><small>Fri · 10 PM</small></div>
        <div className={scopedClasses(authStyles, "auth-art-copy")}><h2>{asideTitle}</h2><p>{asideText}</p></div>
      </aside>
    </main>
  )
}
