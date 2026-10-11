import './global.css'
import { ClientTelemetry } from '@/components/client-telemetry'
import { connection } from 'next/server'

export const metadata = {
  title: { default: 'Puddle', template: '%s · Puddle' },
  description: 'Discover places, save favorites, and find somewhere worth going together.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  applicationName: 'Puddle',
  icons: { icon: '/puddle-tab-icon.svg' },
  // Routes that do not set their own card inherit the PNG. Social platforms will not render
  // an SVG, so a page without this previews blank when it is shared.
  openGraph: {
    type: 'website',
    siteName: 'Puddle',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Puddle — discover places, see who’s there.' }]
  },
  twitter: { card: 'summary_large_image', images: ['/og.png'] }
}

export const viewport = {
  themeColor: '#4ca5f7',
  colorScheme: 'light dark'
}

export default async function RootLayout({ children }) {
  // All Next HTML uses per-request CSP nonces. Cache catalogue data, not the
  // HTML envelope; this also keeps error/auth pages' scripts executable.
  await connection()
  return <html lang="en">
    <head>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="preconnect" href="https://tile.openstreetmap.org" />
    </head>
    <body>
      {children}
      <ClientTelemetry />
    </body>
  </html>
}
