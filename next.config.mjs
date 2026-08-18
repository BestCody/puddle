const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-Frame-Options', value: 'DENY' }
]

const durableAssetCache = [
  { key: 'Cache-Control', value: 'public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800' },
  { key: 'CDN-Cache-Control', value: 'public, s-maxage=31536000, stale-while-revalidate=604800' }
]

const landingAssetCache = [
  { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
  { key: 'CDN-Cache-Control', value: 'public, s-maxage=300, stale-while-revalidate=60' }
]

function mediaRemotePatterns() {
  const patterns = [{ protocol: 'https', hostname: 'cegoqtvajwajczbofpep.supabase.co', pathname: '/storage/v1/object/public/**' }]
  const configured = String(
    process.env.B2_MEDIA_PUBLIC_BASE_URL ||
    process.env.B2_DOWNLOAD_BASE_URL ||
    'https://media.puddle.app'
  ).trim()
  try {
    const url = new URL(configured)
    if (url.protocol === 'https:' && !url.username && !url.password) {
      patterns.push({ protocol: 'https', hostname: url.hostname, port: url.port || '', pathname: `${url.pathname.replace(/\/+$/, '') || ''}/**` || '/**' })
    }
  } catch {}
  return patterns
}

const nextConfig = {
  poweredByHeader: false,
  compress: true,
  images: { formats: ['image/avif', 'image/webp'], minimumCacheTTL: 86400, remotePatterns: mediaRemotePatterns() },
  async headers() {
    return [
      { source: '/avatars/:path*', headers: durableAssetCache },
      { source: '/events/:path*', headers: durableAssetCache },
      { source: '/puddle-mark.svg', headers: durableAssetCache },
      { source: '/og-puddle.svg', headers: durableAssetCache },
      { source: '/landing.css', headers: landingAssetCache },
      { source: '/landing-responsive.css', headers: landingAssetCache },
      { source: '/app.js', headers: landingAssetCache },
      { source: '/:path*', headers: securityHeaders },
      { source: '/landing-demo/:path*', headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }] }
    ]
  },
  async redirects() { return [{ source: '/index.html', destination: '/', permanent: true }] },
  async rewrites() { return { beforeFiles: [{ source: '/', destination: '/landing.html' }] } }
}

export default nextConfig
