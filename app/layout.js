import './auth.css'
import './onboarding.css'
import './product.css'
import './stage-two.css'
import './stage-three-four.css'
import './stage-five.css'
import './stage-six.css'
import './stage-seven.css'
import './stage-eight.css'
import './responsive.css'
import './viewport-responsive.css'

export const metadata = {
  title: { default: 'Puddle', template: '%s · Puddle' },
  description: 'Find events and places worth leaving home for.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000')
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  )
}
