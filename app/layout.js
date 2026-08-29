import './auth.css'
import './input-validation.css'
import './onboarding.css'
import './media-primitives.css'
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
import './membership.css'
import './membership-checkout.css'
import './social-primitives.css'
import './discover-share.css'
import './location-picker.css'
import './figma-public.css'
import './landing-phone-demo.css'
import './figma-dashboard-rebuild.css'
import './figma-dashboard-swipe.css'
import './figma-dashboard-create-post.css'
import './figma-dashboard-create-post-menu.css'
import './figma-dashboard-friends.css'
import './figma-dashboard-pass.css'
import './figma-dashboard-profile.css'
import './figma-dashboard-profile-customize.css'
import './figma-dashboard-settings.css'
import './figma-dashboard-concise.css'
import './functional-completion.css'
import './pass-feature-completion.css'
import './appearance-data.css'
import './performance-loading.css'
import './figma-dashboard-fidelity.css'
import './figma-dashboard-flow.css'
import './discover-controls.css'
import './sidebar-interactions.css'
import './ui-targeted-fixes.css'
import './dark-mode.css'
import './ui-interaction-polish.css'
import './ui-interaction-polish-fixes.css'
import './ui-fixes-20260822.css'
import './ui-followup-20260822.css'
import './mobile-discover-map-polish.css'
import './responsive-density-20260822.css'
import './white-stage-swipe-search-followup-20260822.css'
import './sidebar-swipe-polish.css'
import './profile-sidebar-search-polish-20260823.css'
import './profile-widget-cleanup-20260829.css'
import './mobile-settings-post-polish-20260823.css'
import './desktop-settings-reference-20260823.css'
import './saved-location-morph.css'
import './saved-location-motion-simplified-20260825.css'
import './messages-realtime-polish.css'
import './figma-visual-parity.css'
import './onboarding-widget.css'
import './places-hub.css'
import { SettingsScrollBridge } from '@/components/settings-scroll-bridge'
import { ServiceWorkerCleanup } from '@/components/service-worker-cleanup'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { Analytics } from '@vercel/analytics/next'

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
      <SettingsScrollBridge />
      <ServiceWorkerCleanup />
      {vercelTelemetryEnabled ? <><SpeedInsights /><Analytics /></> : null}
    </body>
  </html>
}
