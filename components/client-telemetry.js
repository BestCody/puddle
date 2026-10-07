'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useReportWebVitals } from 'next/web-vitals'
import { shouldReportClientTelemetry, telemetryRouteGroup } from '@/lib/performance/client-telemetry'
import { sendClientTelemetry } from '@/lib/performance/send-client-telemetry'

function reportWebVital(metric) {
  if (!shouldReportClientTelemetry(window.location.pathname)) return
  sendClientTelemetry({
    event: 'web_vital',
    route: telemetryRouteGroup(window.location.pathname),
    name: metric.name,
    value: metric.value
  })
}

export function ClientTelemetry() {
  const pathname = usePathname()
  useReportWebVitals(reportWebVital)

  useEffect(() => {
    if (!shouldReportClientTelemetry(pathname)) return
    sendClientTelemetry({ event: 'page_view', route: telemetryRouteGroup(pathname) })
  }, [pathname])

  return null
}
