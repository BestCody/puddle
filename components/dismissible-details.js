'use client'

import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState } from 'react'

// Retain native disclosure semantics and existing content/styles. Only transient
// menus use this wrapper; persistent disclosures (such as Plan a visit) do not.
export function DismissibleDetails({ children, onOpen, ref: externalRef = null, ...props }) {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  useImperativeHandle(externalRef, () => ref.current, [])
  const notifyOpen = useEffectEvent(() => onOpen?.())

  // The native disclosure can be opened while hydration scripts are loading.
  // Adopt that DOM state so light-dismiss is attached once React takes over.
  useEffect(() => { setOpen(ref.current.open) }, [])

  function close() {
    ref.current.open = false
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return undefined
    const details = ref.current
    notifyOpen()
    function dismissOutside(event) {
      if (!details.contains(event.target)) {
        details.open = false
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('focusin', dismissOutside)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('focusin', dismissOutside)
    }
  }, [open])

  return <details {...props} ref={ref} onToggle={(event) => {
    setOpen(event.currentTarget.open)
  }} onKeyDown={(event) => {
    if (event.key !== 'Escape' || !event.currentTarget.open) return
    // Consume the inner menu's Escape before it reaches an enclosing dialog.
    event.preventDefault()
    event.stopPropagation()
    close()
    ref.current.querySelector('summary')?.focus({ preventScroll: true })
  }} onClick={(event) => {
    if (event.target.closest('a[href]')) close()
  }}>{children}</details>
}
