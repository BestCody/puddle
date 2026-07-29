import Link from 'next/link'

export function EmptyState({ icon = '✦', title, description, actionHref, actionLabel }) {
  return (
    <section className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">{icon}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {actionHref && actionLabel ? <Link className="splash-button splash-button-mint" href={actionHref}>{actionLabel}</Link> : null}
    </section>
  )
}
