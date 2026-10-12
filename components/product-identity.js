'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

const ProductIdentityContext = createContext(null)
let pendingIdentity = null

// Sidebar, bottom navigation and appearance share one small read. Account data
// stays scoped to this mounted shell, not a module cache surviving sign-out.
export function loadProductIdentity() {
  if (!pendingIdentity) {
    pendingIdentity = fetch('/api/profile/identity', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .catch(() => null)
      .finally(() => { pendingIdentity = null })
  }
  return pendingIdentity
}

export function useProductIdentity() {
  return useContext(ProductIdentityContext)
}

export function ProductIdentityProvider({ children }) {
  const [identity, setIdentity] = useState(null)
  const mounted = useRef(false)
  const refresh = useCallback(async () => {
    const next = await loadProductIdentity()
    if (mounted.current && next) setIdentity(next)
  }, [])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => { mounted.current = false }
  }, [refresh])

  const value = useMemo(() => ({ identity, refresh }), [identity, refresh])
  return <ProductIdentityContext.Provider value={value}>{children}</ProductIdentityContext.Provider>
}
