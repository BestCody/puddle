import './auth.css'
import './product.css'
import './stage-two.css'

export const metadata = {
  title: { default: 'Puddle', template: '%s · Puddle' },
  description: 'Find events and places worth leaving home for.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000')
}

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>
}
