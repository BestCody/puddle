const supportEmail = 'support@valantir.app'
const app = document.querySelector('#app')

const arrow = '→'
const externalArrow = '↗'

function logo(compact = false) {
  return `<a class="brand ${compact ? 'brand--compact' : ''}" href="/" aria-label="Valantir home"><span class="brand__mark"><img src="/logo.webp" alt=""></span><span>Valantir</span></a>`
}

function header() {
  return `<header class="site-header">
    ${logo()}
    <button class="menu-button" aria-expanded="false" aria-label="Toggle navigation"><span></span><span></span></button>
    <div class="header-panel">
      <nav class="main-nav" aria-label="Primary navigation">
        <a href="/#about">About</a><a href="/#mission">Mission</a><a href="/#founders">Founders</a><a href="/#organizations">Organizations</a>
      </nav>
      <div class="header-actions"><a class="text-link" href="/signin">Sign in</a><a class="button button--small button--dark" href="/signup">Sign up ${arrow}</a></div>
    </div>
  </header>`
}

function footer() {
  return `<footer class="footer"><div class="page-shell">
    <div class="footer__top">
      <div><p class="eyebrow">Want to work with us?</p><a class="footer-email" href="mailto:${supportEmail}">${supportEmail} ${externalArrow}</a></div>
      <div class="footer__links"><div><span>Resources</span><a href="/help">Help</a><a href="/terms">Terms</a><a href="/privacy">Privacy Policy</a></div><div><span>Account</span><a href="/signin">Sign in</a><a href="/signup">Sign up</a></div></div>
    </div>
    <div class="footer__wordmark">VALANTIR</div>
    <div class="footer__bottom"><span>© 2026 Valantir</span><a href="https://hxn1.dev" target="_blank" rel="noreferrer">Made by Hani ${externalArrow}</a></div>
  </div></footer>`
}

const testimonials = [
  ['Your volunteer platform, Valantir, is very impressive and user friendly', 'Paula Bildfell', 'External Relations Advisor, AgeCare'],
  ["What a wonderful initiative you've started!", 'Wend Yasen', 'Community Programming Coordinator, Telling Tales'],
  ['What a wonderful platform.', 'Amanda', 'Volunteer Coordinator, Pride Stables'],
]

const faqs = [
  ['What happens when I sign up?', "Pick your interests, postal code, and availability. You'll see opportunities from local nonprofits and businesses, sorted by what fits you best. Every organization is manually reviewed before it can post."],
  ['How are volunteer hours tracked?', 'Log your hours from your portal after each shift. The organization confirms or rejects the entry. Only confirmed hours count toward your total. No honour system, no fake logs.'],
  ['Is it free?', 'Yes. Free for students, free for the nonprofits and small businesses posting opportunities. No paywall, no charge for tracking hours.'],
  ['How does an organization post an opportunity?', "Sign up with an organization account, finish a quick review, then post your opportunity in minutes. You'll see student applications come in, accept the ones you want, and confirm their hours when the work is done."],
]
