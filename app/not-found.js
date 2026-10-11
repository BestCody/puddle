import notFoundStyles from "@/components/not-found.module.css"
import { scopedClasses } from "@/components/scoped-classes"
import { PuddleLogo } from '@/components/puddle-logo'

export default function NotFound() {
  return <main className={scopedClasses(notFoundStyles, "figma-not-found")}>
    <div className={scopedClasses(notFoundStyles, "figma-not-found-card")}>
      <PuddleLogo compact href="/" />
      <div className={scopedClasses(notFoundStyles, "figma-not-found-mark")} aria-hidden="true">404</div>
      <h1>This puddle dried up.</h1>
      <p>The page you were looking for is not here. Head back and keep discovering places.</p>
      <a href="/">Back to Puddle</a>
    </div>
  </main>
}
