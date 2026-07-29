export default function Loading() {
  return (
    <main className="product-loading" aria-label="Loading Puddle">
      <section className="loading-card">
        <div className="loading-puddle" aria-hidden="true" />
        <h1>Making a little splash…</h1>
        <div className="loading-lines" aria-hidden="true"><span /><span /><span /></div>
      </section>
    </main>
  )
}
