import './auth.css'

export const metadata = {
  title: { default: 'Puddle', template: '%s · Puddle' },
  description: 'Find your next plan, one swipe at a time.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000')
}

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>
}
