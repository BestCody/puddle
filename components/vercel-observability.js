"use client"

import Script from 'next/script'

export function VercelObservability() {
  return <>
    <Script id="vercel-web-analytics-init" strategy="afterInteractive">{`
      window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    `}</Script>
    <Script src="/_vercel/insights/script.js" strategy="afterInteractive" />
    <Script id="vercel-speed-insights-init" strategy="afterInteractive">{`
      window.si = window.si || function () { (window.siq = window.siq || []).push(arguments); };
    `}</Script>
    <Script src="/_vercel/speed-insights/script.js" strategy="afterInteractive" />
  </>
}
