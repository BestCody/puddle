import './auth.css'
import './input-validation.css'
import './onboarding.css'
import './date-swipe.css'
import './swipe-v2.css'
import './swipe-motion.css'
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
import './dashboard-saved.css'
import './membership.css'
import './membership-checkout.css'
import './social-hub.css'
import './discover-share.css'
import './sidebar-tooltips.css'
import './location-picker.css'
import './figma-official.css'
import './figma-core-pages.css'
import './figma-social-pass.css'
import './figma-profile-settings.css'
import './figma-feed-map.css'
import './figma-public.css'
import './landing-phone-demo.css'
import './product-polish.css'
import './figma-parity.css'
import { ServiceWorkerCleanup } from '@/components/service-worker-cleanup'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { Analytics } from '@vercel/analytics/next'

export const metadata = {
  title: { default: 'Puddle', template: '%s · Puddle' },
  description: 'Discover places, save favorites, and find somewhere worth going together.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  applicationName: 'Puddle',
  icons: { icon: '/puddle-mark.svg' }
}

export const viewport = {
  themeColor: '#4ca5f7',
  colorScheme: 'light'
}

export default function RootLayout({ children }) {
  const vercelTelemetryEnabled = process.env.VERCEL === '1'

  return <html lang="en">
    <head>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="preconnect" href="https://tile.openstreetmap.org" />
    </head>
    <body>
      {children}
      <ServiceWorkerCleanup />
      {vercelTelemetryEnabled ? <><SpeedInsights /><Analytics /></> : null}
    </body>
  </html>
}
