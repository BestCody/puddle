import { PuddleLogo } from '@/components/puddle-logo'

export default function NotFound() {
  return <main className="figma-not-found">
    <div className="figma-not-found-card">
      <PuddleLogo compact href="/" />
      <div className="figma-not-found-mark" aria-hidden="true">404</div>
      <h1>This puddle dried up.</h1>
      <p>The page you were looking for is not here. Head back and keep discovering places.</p>
      <a href="/">Back to Puddle</a>
    </div>
  </main>
}
