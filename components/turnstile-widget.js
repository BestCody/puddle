"use client"

import Script from 'next/script'
import { useEffect, useId, useRef } from 'react'

export function TurnstileWidget({ action, onToken }) {
  const id = `turnstile-${useId().replaceAll(':','')}`
  const widget = useRef(null)
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  function render() {
    if (!siteKey || !window.turnstile || widget.current) return
    widget.current = window.turnstile.render(`#${id}`, {
      sitekey: siteKey,
      action,
      theme: 'auto',
      retry: 'auto',
      'response-field': true,
      callback: (token) => onToken?.(token),
      'expired-callback': () => onToken?.(''),
      'error-callback': () => onToken?.('')
    })
  }
  useEffect(() => { render(); return () => { if (widget.current && window.turnstile) window.turnstile.remove(widget.current) } }, [])
  if (!siteKey) return <input type="hidden" name="cf-turnstile-response" value="" />
  return <div className="turnstile-field"><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onLoad={render}/><div id={id}/></div>
}
