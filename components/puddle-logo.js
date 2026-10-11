import logoStyles from "@/components/puddle-logo.module.css"
import { scopedClasses } from "@/components/scoped-classes"
import Link from 'next/link'

export function PuddleLogo({ compact = false, href = '/', variant = 'brand' }) {
  const mark = variant === 'outline' ? '/puddle-mark-outline.svg' : '/puddle-mark.svg'
  return (
    <Link className={scopedClasses(logoStyles, "puddle-logo")} href={href} aria-label={href === '/discover' ? 'Open Swipe' : 'Puddle home'}>
      <img src={mark} alt="" width="44" height="44" />
      {!compact && <span>puddle<span className={scopedClasses(logoStyles, "logo-dot")}>.you</span></span>}
    </Link>
  )
}
