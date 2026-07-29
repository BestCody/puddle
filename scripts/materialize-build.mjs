import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const bootstrap = join(root, '.bootstrap')
const archive = join('/tmp', 'puddle-production.tar.gz')

if (existsSync(bootstrap)) {
  const chunks = Array.from({ length: 8 }, (_, index) =>
    readFileSync(join(bootstrap, `chunk${String(index).padStart(2, '0')}`), 'utf8')
  ).join('')

  writeFileSync(archive, Buffer.from(chunks, 'base64'))
  execFileSync('tar', ['-xzf', archive, '-C', root], { stdio: 'inherit' })

  mkdirSync(join(root, 'public'), { recursive: true })
  copyFileSync(join(root, 'styles.css'), join(root, 'public', 'styles.css'))
  copyFileSync(join(root, 'app.js'), join(root, 'public', 'app.js'))

  rmSync(join(root, 'next.config.ts'), { force: true })
  writeFileSync(join(root, 'next.config.mjs'), `
const csp = [
  "default-src 'self'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'", "object-src 'none'",
  "img-src 'self' data: blob: https:", "font-src 'self' https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://js.stripe.com",
  "frame-src https://challenges.cloudflare.com https://js.stripe.com https://hooks.stripe.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://challenges.cloudflare.com https://api.openai.com",
  "worker-src 'self' blob:", "upgrade-insecure-requests"
].join('; ')
const config = {
  poweredByHeader: false,
  typescript: { ignoreBuildErrors: true },
  async headers() { return [{ source: '/:path*', headers: [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(self)' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
    { key: 'X-Frame-Options', value: 'DENY' }
  ] }] }
}
export default config
`)
}

const command = process.platform === 'win32'
  ? join(root, 'node_modules', '.bin', 'next.cmd')
  : join(root, 'node_modules', '.bin', 'next')
const mode = process.argv.includes('--dev') ? 'dev' : 'build'
execFileSync(command, [mode], { cwd: root, stdio: 'inherit' })
