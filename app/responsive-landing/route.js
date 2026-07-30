import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const landingPath = join(process.cwd(), 'public', 'landing.html')

function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Landing restoration marker missing: ${label}`)
  return source.replace(search, replacement)
}

export async function GET() {
  let html = await readFile(landingPath, 'utf8')

  html = replaceRequired(
    html,
    '<link rel="stylesheet" href="/styles.css?v=1" />',
    '<link rel="stylesheet" href="/styles.css?v=3" />\n    <link rel="stylesheet" href="/landing-restoration.css?v=3" />',
    'styles'
  )

  html = replaceRequired(
    html,
    '<div class="header-actions"><button class="button button--ghost" data-open-modal="waitlist">Join waitlist</button><button class="button button--ink" data-open-app>Open Puddle <span>↗</span></button></div>',
    '<div class="header-actions"><a class="button button--ghost" href="/signin">Sign In</a><a class="button button--ink" href="/signup">Register <span>↗</span></a></div>',
    'desktop authentication actions'
  )

  html = replaceRequired(
    html,
    '<button class="menu-button" type="button" aria-label="Open menu" aria-expanded="false"><span></span><span></span></button>',
    `<button class="menu-button" type="button" aria-label="Open menu" aria-controls="mobile-menu" aria-expanded="false"><span></span><span></span></button>
      <div class="mobile-menu" id="mobile-menu">
        <nav aria-label="Mobile navigation"><a href="#how">How it works</a><a href="#social">Social</a><a href="#organizers">Organizers</a><a href="#safety">Safety</a></nav>
        <div class="mobile-menu-actions"><a class="button button--ghost" href="/signin">Sign In</a><a class="button button--ink" href="/signup">Register <span>↗</span></a></div>
      </div>`,
    'mobile menu'
  )

  html = replaceRequired(
    html,
    '<div><button class="button button--ink button--large" data-open-app>Open Puddle <span>→</span></button><button class="button button--cream button--large" data-open-modal="waitlist">Join the beta</button></div>',
    '<div><button class="button button--ink button--large" data-open-app>Try the Puddle demo <span>→</span></button><a class="button button--cream button--large" href="/signup">Register</a></div>',
    'final call to action'
  )

  html = replaceRequired(
    html,
    '<strong>Get early access</strong><form class="footer-form" data-waitlist-form><input type="email" required placeholder="you@email.com" aria-label="Email address" /><button type="submit">→</button></form><small>No spam. Just launch updates and good plans.</small>',
    '<strong>Create your account</strong><form class="footer-form" action="/signup" method="get"><input name="email" type="email" required placeholder="you@email.com" aria-label="Email address" /><button type="submit" aria-label="Continue to registration">→</button></form><small>Already registered? Use Sign In at the top of the page.</small>',
    'footer registration form'
  )

  html = replaceRequired(
    html,
    '<button data-app-view="messages">✉<span>Chat</span></button></nav>',
    '<button data-app-view="messages">✉<span>Chat</span></button><button data-app-view="tickets">▤<span>Tickets</span></button></nav>',
    'mobile demo tickets navigation'
  )

  html = replaceRequired(
    html,
    '<script src="/app.js?v=1" defer></script>',
    '<script src="/landing-demo.js?v=3" defer></script><script src="/landing-bootstrap.js?v=3" defer></script>',
    'interactive landing scripts'
  )

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0'
    }
  })
}
