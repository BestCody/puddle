import Link from 'next/link'

export function PuddleLogo({ compact = false, href = '/', variant = 'brand' }) {
  const mark = variant === 'outline' ? '/puddle-mark-outline.svg' : '/puddle-mark.svg'
  return (
    <Link className="puddle-logo" href={href} aria-label={href === '/discover' ? 'Open Swipe' : 'Puddle home'}>
      <img src={mark} alt="" width="44" height="44" />
      {!compact && <span>puddle<span className="logo-dot">.you</span></span>}
    </Link>
  )
}