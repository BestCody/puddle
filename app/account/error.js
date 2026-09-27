'use client'

export default function SettingsError({ reset }) {
  return <main className="product-loading">
    <section className="loading-card" role="alert">
      <h1>Settings are unavailable.</h1>
      <p>Your preferences have not been changed. Please try loading them again.</p>
      <button className="splash-button splash-button-mint" type="button" onClick={() => reset()}>Try again</button>
    </section>
  </main>
}
