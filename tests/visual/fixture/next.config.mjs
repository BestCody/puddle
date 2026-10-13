import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

// An isolated test app: these routes never enter the production application.
export default {
  devIndicators: false,
  turbopack: { root, resolveAlias: {
    '@': root,
    '@/app/(product)/create/post/actions': './mocks/failing-actions.js',
    '@/app/report/actions': './mocks/failing-actions.js',
    '@/app/(product)/map/actions': './mocks/feed-actions.js',
    '@/lib/auth/sign-up': './mocks/signup.js',
    '@/lib/auth/user': './mocks/data.js',
    '@/lib/supabase/client': './mocks/data.js',
    '@/lib/supabase/server': './mocks/data.js',
    '@/lib/supabase/admin': './mocks/unavailable-admin.js',
    '@/lib/app/render-product-page': './mocks/render-product-page.js',
    '@/lib/app/global-location-search': './mocks/data.js',
    '@/lib/app/location-previews': './mocks/data.js',
    '@/lib/app/membership-data': './mocks/data.js',
    '@/lib/app/location-plans-data': './mocks/data.js',
    '@/lib/app/location-map-data': './mocks/data.js',
    '@/lib/app/public-content': './mocks/data.js'
  } },
  images: { unoptimized: true },
  env: { VISUAL_PUBLIC_ROOT: path.join(root, 'public'), NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'fixture-safety-key' },
  async rewrites() {
    return [{ source: '/', destination: '/assets/landing.html' },
      { source: '/figma/:path*', destination: '/assets/figma/:path*' },
      { source: '/puddle-mark.svg', destination: '/assets/puddle-mark.svg' },
      { source: '/puddle-mark-outline.svg', destination: '/assets/puddle-mark-outline.svg' }]
      .concat(['landing.html', 'landing.css', 'app.js'].map(file => ({ source: `/${file}`, destination: `/assets/${file}` })))
  }
}
