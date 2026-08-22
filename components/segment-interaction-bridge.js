"use client"

import { useEffect } from 'react'

function directControls(segment) {
  return Array.from(segment.children).filter((child) => child.matches('a, button'))
}

function setActive(segment, index, { optimistic = false } = {}) {
  const controls = directControls(segment)
  if (!controls.length) return
  const boundedIndex = Math.max(0, Math.min(index, controls.length - 1))
  const active = controls[boundedIndex]
  segment.dataset.segmentEnhanced = 'true'
  segment.dataset.segmentCount = String(controls.length)
  segment.style.setProperty('--segment-count', String(controls.length))
  segment.style.setProperty('--segment-active-index', String(boundedIndex))
  segment.style.setProperty('--segment-active-left', `${active.offsetLeft}px`)
  segment.style.setProperty('--segment-active-width', `${active.offsetWidth}px`)
  controls.forEach((control, controlIndex) => {
    const selected = controlIndex === boundedIndex
    control.classList.toggle('is-ui-active', selected)
    if (optimistic && segment.classList.contains('figma-friends-tabs')) {
      control.classList.toggle('is-active', selected)
      if (selected) control.setAttribute('aria-current', 'page')
      else control.removeAttribute('aria-current')
    }
  })
}

function initialize(segment) {
  if (!(segment instanceof HTMLElement) || segment.classList.contains('figma-instant-segment')) return
  const controls = directControls(segment)
  if (!controls.length) return
  const serverActiveIndex = controls.findIndex((control) =>
    control.classList.contains('is-active') ||
    control.getAttribute('aria-current') === 'page'
  )
  setActive(segment, serverActiveIndex >= 0 ? serverActiveIndex : 0)
}

export function SegmentInteractionBridge() {
  useEffect(() => {
    function initializeAll(root = document) {
      if (root instanceof Element && root.matches('.figma-dashboard-segment')) initialize(root)
      root.querySelectorAll?.('.figma-dashboard-segment').forEach(initialize)
    }

    function onPointerDown(event) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const control = event.target.closest('.figma-dashboard-segment > a, .figma-dashboard-segment > button')
      const segment = control?.parentElement
      if (!segment || segment.classList.contains('figma-instant-segment')) return
      const controls = directControls(segment)
      const index = controls.indexOf(control)
      if (index >= 0) setActive(segment, index, { optimistic: true })
    }

    function onResize() {
      document.querySelectorAll('.figma-dashboard-segment[data-segment-enhanced="true"]').forEach((segment) => {
        const index = Number(segment.style.getPropertyValue('--segment-active-index')) || 0
        setActive(segment, index)
      })
    }

    initializeAll()
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', onResize)
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) initializeAll(node)
        })
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', onResize)
      observer.disconnect()
    }
  }, [])

  return null
}
