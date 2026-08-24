"use client"

import { useEffect } from 'react'

const SEND_LABEL = /^(send|send message|send comment|submit comment|post comment|reply|send reply|publish|publish post|post)$/i

function isTextSendAction(button) {
  if (!(button instanceof HTMLButtonElement)) return false
  if (button.classList.contains('puddle-send-action')) return true
  if (button.closest('.discover-share-trigger, .social-row-actions')) return false

  const form = button.closest('form')
  if (!form) return false
  const hasTextEntry = Boolean(form.querySelector('textarea, input[type="text"], input:not([type]), input[type="search"]'))
  if (!hasTextEntry) return false

  const label = String(button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent || '').trim()
  return SEND_LABEL.test(label)
}

function applySendActionStyle(root = document) {
  root.querySelectorAll?.('button').forEach((button) => {
    if (isTextSendAction(button)) button.classList.add('puddle-send-action')
  })
}

export function SendActionStyleBridge() {
  useEffect(() => {
    applySendActionStyle()
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue
          if (node.matches('button') && isTextSendAction(node)) node.classList.add('puddle-send-action')
          applySendActionStyle(node)
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  return null
}
