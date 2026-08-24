"use client"

import { useEffect } from 'react'
import { savedLocationTransitionNames } from '@/lib/app/saved-location-transition'

const STORAGE_KEY = 'puddle:saved-location-morph'

function applyNames(card) {
  const key = card?.dataset?.savedMorphKey
  if (!card || !key) return null
  const names = savedLocationTransitionNames(key)
  card.style.viewTransitionName = names.card
  const photo = card.querySelector('[data-saved-morph-photo]')
  const title = card.querySelector('[data-saved-morph-title]')
  const meta = card.querySelector('[data-saved-morph-meta]')
  if (photo) photo.style.viewTransitionName = names.photo
  if (title) title.style.viewTransitionName = names.title
  if (meta) meta.style.viewTransitionName = names.meta
  return key
}

export function SavedLocationMorphBridge({ detailLocationId = null }) {
  useEffect(() => {
    function armFromTarget(target) {
      const card = target?.closest?.('[data-saved-morph-card]')
      if (!card) return null
      const key = applyNames(card)
      if (key) {
        try { sessionStorage.setItem(STORAGE_KEY, key) } catch {}
      }
      return key
    }

    function onPointerDown(event) {
      if (event.button !== 0) return
      if (event.target.closest('[data-saved-morph-link]')) armFromTarget(event.target)
    }

    function onClick(event) {
      const link = event.target.closest('[data-saved-morph-link]')
      if (link) {
        armFromTarget(link)
        return
      }

      const back = event.target.closest('[data-saved-morph-back]')
      if (!back || !detailLocationId) return
      let stored = null
      try { stored = sessionStorage.getItem(STORAGE_KEY) } catch {}
      if (stored !== String(detailLocationId)) return

      event.preventDefault()
      if (history.length > 1) history.back()
      else window.location.assign(back.href)
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [detailLocationId])

  return null
}
