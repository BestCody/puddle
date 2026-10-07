const SAMPLE_RATE = 0.1

export function sendClientTelemetry(event) {
  if (typeof window === 'undefined' || Math.random() >= SAMPLE_RATE || window.navigator.doNotTrack === '1') return
  void fetch('/api/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    keepalive: true
  }).catch(() => {})
}
