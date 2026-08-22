"use client"

import { useEffect } from 'react'

const SECTION_IDS = ['profile', 'security', 'appearance', 'notifications', 'sessions', 'billing', 'account']

function sectionFromLink(link) {
  try {
    return new URL(link.href, window.location.href).searchParams.get('section')
  } catch {
    return null
  }
}

export function SettingsScrollBridge() {
  useEffect(() => {
    let activeContainer = null
    let detach = () => {}
    let scheduled = false

    function wireSettings() {
      scheduled = false
      const container = document.querySelector('.figma-settings-detail')
      if (container === activeContainer) return

      detach()
      activeContainer = container
      if (!container) {
        detach = () => {}
        return
      }

      const sections = SECTION_IDS.map((id) => document.getElementById(id)).filter(Boolean)
      const links = [...document.querySelectorAll('.figma-settings-local-nav a')]
        .map((link) => ({ link, id: sectionFromLink(link) }))
        .filter((item) => item.id && SECTION_IDS.includes(item.id))

      if (!sections.length || !links.length) return

      let frame = 0
      let currentId = ''

      function setActive(id) {
        if (!id || id === currentId) return
        currentId = id
        for (const item of links) {
          const active = item.id === id
          item.link.dataset.active = active ? 'true' : 'false'
          if (active) item.link.setAttribute('aria-current', 'location')
          else item.link.removeAttribute('aria-current')
        }
      }

      function updateFromScroll() {
        frame = 0
        const containerRect = container.getBoundingClientRect()
        const markerY = containerRect.top + Math.min(220, Math.max(96, container.clientHeight * .34))
        let visible = sections[0]

        for (const section of sections) {
          const rect = section.getBoundingClientRect()
          if (rect.top <= markerY) visible = section
          else break
        }

        setActive(visible.id)
      }

      function onScroll() {
        if (frame) return
        frame = window.requestAnimationFrame(updateFromScroll)
      }

      function onClick(event) {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        const link = event.currentTarget
        const id = sectionFromLink(link)
        const section = id ? document.getElementById(id) : null
        if (!section) return

        event.preventDefault()
        setActive(id)
        container.scrollTo({ top: Math.max(0, section.offsetTop - 12), behavior: 'smooth' })

        const nextUrl = new URL(window.location.href)
        nextUrl.searchParams.set('section', id)
        window.history.replaceState(window.history.state, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`)
      }

      for (const item of links) item.link.addEventListener('click', onClick)
      container.addEventListener('scroll', onScroll, { passive: true })
      window.addEventListener('resize', onScroll, { passive: true })

      const requested = new URLSearchParams(window.location.search).get('section')
      const initial = SECTION_IDS.includes(requested) ? requested : SECTION_IDS[0]
      const initialSection = document.getElementById(initial)
      if (initialSection) {
        container.scrollTop = Math.max(0, initialSection.offsetTop - 12)
        setActive(initial)
      }
      updateFromScroll()

      detach = () => {
        if (frame) window.cancelAnimationFrame(frame)
        container.removeEventListener('scroll', onScroll)
        window.removeEventListener('resize', onScroll)
        for (const item of links) item.link.removeEventListener('click', onClick)
      }
    }

    function scheduleWire() {
      if (scheduled) return
      scheduled = true
      window.requestAnimationFrame(wireSettings)
    }

    wireSettings()
    const observer = new MutationObserver(scheduleWire)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      detach()
    }
  }, [])

  return null
}
