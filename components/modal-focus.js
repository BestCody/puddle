"use client"

import { useEffect } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'summary',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function focusable(container) {
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter((element) => {
    if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName !== 'DETAILS' || parent.open) continue
      const summary = [...parent.children].find(child => child.tagName === 'SUMMARY')
      if (!summary?.contains(element)) return false
    }
    const style = window.getComputedStyle(element)
    return element.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse'
  })
}

export function useModalFocus(containerRef, initialFocusRef = null, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined
    const container = containerRef.current
    if (!container) return undefined
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => {
      const target = initialFocusRef?.current || focusable(container)[0] || container
      target.focus()
    })

    function keepFocusInside(event) {
      if (event.key !== 'Tab') return
      const elements = focusable(container)
      if (!elements.length) {
        event.preventDefault()
        container.focus()
        return
      }
      const first = elements[0]
      const last = elements.at(-1)
      const outside = !container.contains(document.activeElement)
      if (event.shiftKey && (document.activeElement === first || outside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || outside)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', keepFocusInside)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', keepFocusInside)
      if (previous?.isConnected) previous.focus()
    }
  }, [containerRef, initialFocusRef, enabled])
}
