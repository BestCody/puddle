'use client'

import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState } from 'react'

// Retain native disclosure semantics and existing content/styles. Only transient
// menus use this wrapper; persistent disclosures (such as Plan a visit) do not.
export function DismissibleDetails({ children, onOpen, fitAbove = null, ref: externalRef = null, ...props }) {
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
    const menu = fitAbove ? details.querySelector(':scope > nav, :scope > div') : null
    const dock = typeof fitAbove === 'string' ? document.querySelector(fitAbove) : null
    function sizeMenu() {
      if (!menu) return
      const viewport = window.visualViewport
      let bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight
      let left = viewport?.offsetLeft || 0
      let right = left + (viewport?.width || document.documentElement.clientWidth)
      for (let parent = details.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent), rect = parent.getBoundingClientRect()
        if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)) bottom = Math.min(bottom, rect.bottom)
        if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) { left = Math.max(left, rect.left); right = Math.min(right, rect.right) }
      }
      const dockRect = dock?.getBoundingClientRect()
      const dockTop = dockRect?.width && dockRect?.height ? dockRect.top : bottom
      const gutter = parseFloat(getComputedStyle(menu).paddingTop) || 0
      const rect = menu.getBoundingClientRect()
      const shift = parseFloat(menu.style.getPropertyValue('--menu-shift-x')) || 0
      const naturalLeft = rect.left - shift, naturalRight = rect.right - shift
      menu.style.setProperty('--menu-shift-x', `${Math.max(0, left + gutter - naturalLeft) - Math.max(0, naturalRight - right + gutter)}px`)
      menu.style.setProperty('--menu-available-height', `${Math.max(0, Math.min(bottom, dockTop) - rect.top - gutter)}px`)
    }
    sizeMenu()
    const observer = menu ? new ResizeObserver(sizeMenu) : null
    if (dock && observer) observer.observe(dock)
    if (menu) { observer.observe(details); observer.observe(menu) }
    if (menu) {
      window.addEventListener('resize', sizeMenu)
      window.addEventListener('scroll', sizeMenu, true)
      window.visualViewport?.addEventListener('resize', sizeMenu)
      window.visualViewport?.addEventListener('scroll', sizeMenu)
    }
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
      observer?.disconnect()
      window.removeEventListener('resize', sizeMenu)
      window.removeEventListener('scroll', sizeMenu, true)
      window.visualViewport?.removeEventListener('resize', sizeMenu)
      window.visualViewport?.removeEventListener('scroll', sizeMenu)
    }
  }, [open, fitAbove])

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
