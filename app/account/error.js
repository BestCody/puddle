'use client'
import sharedUIStyles from "@/components/shared-ui.module.css"
import { scopedClasses } from "@/components/scoped-classes"

export default function SettingsError({ reset }) {
  return <main className={scopedClasses(sharedUIStyles, "product-loading")}>
    <section className={scopedClasses(sharedUIStyles, "loading-card")} role="alert">
      <h1>Settings are unavailable.</h1>
      <p>Your preferences have not been changed. Please try loading them again.</p>
      <button className={scopedClasses(sharedUIStyles, "splash-button splash-button-mint")} type="button" onClick={() => reset()}>Try again</button>
    </section>
  </main>
}
