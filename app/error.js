"use client"

export default function GlobalError({ reset }) {
  return (
    <main className="product-loading">
      <section className="loading-card" role="alert">
        <div className="loading-puddle" aria-hidden="true" />
        <h1>Tiny wipeout.</h1>
        <p>Puddle could not load this screen. Your account and saved data were not changed.</p>
        <button className="splash-button splash-button-mint" type="button" onClick={() => reset()}>Try again</button>
      </section>
    </main>
  )
}
