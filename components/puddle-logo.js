import Link from 'next/link'

export function PuddleLogo({ compact = false, href = '/' }) {
  return (
    <Link className="puddle-logo" href={href} aria-label={href === '/discover' ? 'Open Swipe' : 'Puddle home'}>
      <img src="/puddle-mark.svg" alt="" width="44" height="44" />
      {!compact && <span>puddle<span className="logo-dot">.you</span></span>}
    </Link>
  )
}
