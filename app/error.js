"use client"
import sharedUIStyles from "@/components/shared-ui.module.css"
import { scopedClasses } from "@/components/scoped-classes"

export default function GlobalError({ reset }) {
  return (
    <main className={scopedClasses(sharedUIStyles, "product-loading")}>
      <section className={scopedClasses(sharedUIStyles, "loading-card")} role="alert">
        <div className={scopedClasses(sharedUIStyles, "loading-puddle")} aria-hidden="true" />
        <h1>Tiny wipeout.</h1>
        <p>Puddle could not load this screen. Your account and saved data were not changed.</p>
        <button className={scopedClasses(sharedUIStyles, "splash-button splash-button-mint")} type="button" onClick={() => reset()}>Try again</button>
      </section>
    </main>
  )
}
