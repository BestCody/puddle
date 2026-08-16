import './globals.css'
import './figma-core-pages.css'
import './figma-dashboard-settings.css'
import './figma-dashboard-create-post-menu.css'
import './functional-completion.css'

export const metadata = {
  title: {
    default: 'Puddle',
    template: '%s · Puddle'
  },
  description: 'Discover places, make plans, and share puddles.'
}

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>
}
