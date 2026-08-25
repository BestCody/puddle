import { Suspense } from 'react'
import { headers } from 'next/headers'
import { ProductShell } from '@/components/product-shell'
import { requireUser } from '@/lib/auth/user'

async function usesPersistentProductShell() {
  try {
    const requestHeaders = await headers()
    return requestHeaders.get('x-puddle-product-route') === '1'
  } catch {
    return false
  }
}

async function AwaitRouteContent({ contentPromise }) {
  return await contentPromise
}

function PersistentRouteFallback() {
  return <div className="puddle-route-stream-placeholder" role="status" aria-label="Loading page content">
    <svg className="puddle-main-spinner" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.16" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.7s" repeatCount="indefinite" />
      </path>
    </svg>
  </div>
}

export async function renderProductPage(render) {
  const session = await requireUser({ onboarding: true })
  const contentPromise = render(session)
  if (await usesPersistentProductShell()) {
    return <Suspense fallback={<PersistentRouteFallback />}>
      <AwaitRouteContent contentPromise={contentPromise} />
    </Suspense>
  }
  return (
    <ProductShell user={session.user} profile={session.profile} contentPromise={contentPromise} />
  )
}
