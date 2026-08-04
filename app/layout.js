import './auth.css'
import './onboarding.css'
import './date-swipe.css'
import './swipe-v2.css'
import './date-match.css'
import './real-place-photos.css'
import './product.css'
import './sidebar-refresh.css'
import './home-dashboard.css'
import './stage-two.css'
import './stage-three-four.css'
import './stage-seven.css'
import './stage-eight.css'
import './responsive.css'
import './viewport-responsive.css'
import './group-map.css'
import './minimal-product.css'
import './membership.css'
import './sidebar-tooltips.css'
import './location-picker.css'
import { ServiceWorkerCleanup } from '@/components/service-worker-cleanup'

export const metadata = {
  title: { default: 'Puddle', template: '%s · Puddle' },
  description: 'Swipe through nearby places and find somewhere worth going together.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  applicationName: 'Puddle',
  icons: { icon: '/puddle-mark.svg' }
}

export const viewport = {
  themeColor: '#ff4f7b',
  colorScheme: 'light'
}

export default function RootLayout({ children }) {
  return <html lang="en">
    <head>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="preconnect" href="https://tile.openstreetmap.org" />
    </head>
    <body>{children}<ServiceWorkerCleanup /></body>
  </html>
}
