import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const landingPath = join(process.cwd(), 'public', 'landing.html')

const landingStyles = String.raw`/* Responsive restoration: scale the landing page without removing functionality. */
:root{
  --shell:min(1440px,calc(100vw - clamp(24px,6vw,120px)));
  --landing-gap:clamp(16px,2vw,32px);
  --landing-pad:clamp(20px,3vw,42px);
}
html{font-size:clamp(15px,calc(14px + .18vw),18px);text-size-adjust:100%;-webkit-text-size-adjust:100%}
body{min-width:280px}
img,svg,video,canvas{max-width:100%}
button,input,select,textarea{max-width:100%}
.reveal{opacity:1;transform:none}
.landing-js .reveal{opacity:0;transform:translateY(24px)}
.landing-js .reveal.is-visible{opacity:1;transform:none}
.site-header{width:min(1440px,calc(100vw - clamp(18px,4vw,64px)));height:clamp(62px,5vw,72px);padding-inline:clamp(14px,2vw,24px)}
.desktop-nav{gap:clamp(16px,2vw,32px);margin-left:clamp(18px,4vw,64px)}
.header-actions{margin-left:auto}
.button{min-height:44px;padding:clamp(10px,1vw,13px) clamp(14px,1.4vw,20px)}
.mobile-menu{display:none;position:absolute;top:calc(100% + 10px);right:0;width:min(390px,calc(100vw - 18px));padding:18px;border:1px solid var(--line);border-radius:20px;background:rgba(255,250,246,.98);box-shadow:0 22px 55px rgba(54,25,45,.2);backdrop-filter:blur(18px)}
.mobile-menu nav{display:grid;gap:4px}
.mobile-menu nav a{padding:12px;border-radius:12px;font-weight:800}
.mobile-menu nav a:hover{background:var(--pink-soft)}
.mobile-menu-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
.site-header.menu-open::after{content:none;display:none}
.site-header.menu-open .mobile-menu{display:grid}
.hero{grid-template-columns:minmax(0,1fr) minmax(330px,.9fr);gap:clamp(24px,5vw,72px);padding:clamp(110px,12vh,150px) 0 clamp(55px,8vh,90px)}
.hero h1{font-size:clamp(3.6rem,7.3vw,8.2rem)}
.hero-lede{font-size:clamp(1rem,.35vw + .95rem,1.22rem)}
.hero-playground{min-height:clamp(540px,68vw,700px)}
.phone-shell{width:clamp(300px,31vw,400px);height:auto;aspect-ratio:382/680;padding:clamp(13px,1.3vw,18px);border-radius:clamp(34px,3.2vw,46px)}
.deck{height:calc(100% - 180px)}
.event-card__body{padding:clamp(14px,1.3vw,20px)}
.event-card h3{font-size:clamp(1.35rem,1.7vw,1.75rem)}
.section{padding:clamp(72px,9vw,128px) 0}
.section-heading{grid-template-columns:clamp(54px,6vw,76px) minmax(0,1fr) minmax(240px,.72fr);gap:var(--landing-gap);margin-bottom:clamp(36px,5vw,64px)}
.section-heading h2,.ticket-copy h2,.safety-copy h2,.final-cta h2{font-size:clamp(2.6rem,5vw,5.8rem)}
.feature-bento,.social-stage,.ticket-layout,.safety-panel,.footer-grid{gap:var(--landing-gap)}
.bento-card{min-height:clamp(390px,34vw,490px);padding:var(--landing-pad);border-radius:clamp(26px,2.5vw,36px)}
.bento-card h3{font-size:clamp(2rem,3.4vw,4.1rem)}
.social-stage{grid-template-columns:minmax(300px,1.1fr) minmax(260px,.9fr) minmax(260px,.9fr)}
.social-column{min-height:clamp(470px,42vw,560px);padding:clamp(16px,1.7vw,24px)}
.organizer-board{grid-template-columns:clamp(190px,17vw,240px) minmax(0,1fr);min-height:clamp(580px,55vw,700px)}
.organizer-main{min-width:0;padding:clamp(20px,2.6vw,38px)}
.metric-grid{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.ticket-layout{grid-template-columns:minmax(0,1fr) minmax(330px,1fr);gap:clamp(40px,7vw,90px)}
.ticket-stack{min-height:clamp(550px,48vw,680px)}
.ticket{width:clamp(300px,31vw,410px);min-height:clamp(510px,44vw,590px)}
.safety-panel{grid-template-columns:minmax(260px,.9fr) minmax(0,1.1fr);padding:clamp(28px,4vw,64px)}
.final-cta__inner{padding:clamp(70px,8vw,110px) clamp(20px,4vw,48px)}
.footer-grid{grid-template-columns:minmax(240px,1.4fr) repeat(2,minmax(120px,.6fr)) minmax(220px,1fr)}
.app-shell{width:min(1600px,100%);grid-template-columns:clamp(190px,17vw,250px) minmax(0,1fr)}
.app-topbar{height:clamp(88px,7vw,108px);padding:clamp(16px,2vw,28px)}
.app-view{height:calc(100% - clamp(88px,7vw,108px));padding:clamp(16px,2vw,30px)}
.demo-grid{grid-template-columns:minmax(340px,.92fr) minmax(320px,1.08fr);gap:var(--landing-gap)}
.demo-deck-panel{min-height:clamp(560px,62vh,690px)}
.demo-deck{width:min(390px,88%);height:clamp(520px,58vh,590px)}
.explore-list,.plans-grid,.ticket-wallet,.match-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))}
.messages-demo{grid-template-columns:clamp(240px,27vw,330px) minmax(0,1fr)}
.modal{width:min(680px,100%);padding:clamp(24px,3vw,38px)}

@media (max-height:760px) and (min-width:781px){
  .hero{padding-top:100px;padding-bottom:42px}
  .hero-playground{min-height:520px}
  .phone-shell{width:min(310px,29vw)}
  .section{padding-block:72px}
  .app-shell{height:calc(100dvh - 20px)}
}

@media (min-width:1600px){
  :root{--shell:min(1520px,calc(100vw - 140px))}
  .site-header{width:min(1520px,calc(100vw - 120px))}
}

@media (max-width:1100px){
  .desktop-nav{display:none}
  .menu-button{display:grid;margin-left:8px}
  .hero{grid-template-columns:minmax(0,1fr) minmax(300px,.85fr);gap:24px}
  .social-stage{grid-template-columns:1fr 1fr}
  .social-column--location{grid-column:1/-1}
  .analytics-row{grid-template-columns:1fr}
  .footer-grid{grid-template-columns:1.2fr .7fr .7fr}
  .footer-grid>div:last-child{grid-column:1/-1}
  .demo-grid{grid-template-columns:1fr;height:auto}
  .demo-side-panel{display:flex}
  .explore-grid{grid-template-columns:1fr}
  .explore-map{display:block;position:relative;top:auto;height:min(70svh,520px);margin-top:18px}
}

@media (max-width:780px){
  :root{--shell:min(680px,calc(100% - 28px))}
  html{font-size:16px}
  .site-header{top:9px;width:calc(100vw - 18px)}
  .header-actions{display:none}
  .mobile-menu{left:0;right:0;width:100%}
  .hero{grid-template-columns:1fr;padding-top:105px;gap:18px}
  .hero-copy{text-align:center}
  .hero .eyebrow,.hero-actions,.social-proof{justify-content:center}
  .hero h1{font-size:clamp(3.5rem,15vw,6.3rem)}
  .hero-playground{min-height:clamp(520px,165vw,650px)}
  .phone-shell{width:min(350px,88vw)}
  .section-heading{grid-template-columns:54px minmax(0,1fr)}
  .section-heading>p{grid-column:2}
  .feature-bento,.social-stage,.ticket-layout,.safety-panel{grid-template-columns:1fr}
  .bento-card--pink{grid-row:auto}
  .social-column--location{grid-column:auto}
  .organizer-board{grid-template-columns:1fr}
  .organizer-sidebar{display:flex;padding:16px;min-width:0}
  .organizer-sidebar nav{display:flex;gap:8px;margin:16px 0;overflow-x:auto;padding-bottom:5px;scrollbar-width:thin}
  .organizer-sidebar nav button{flex:0 0 auto}
  .organizer-sidebar>.button{align-self:flex-start}
  .safety-panel{padding:clamp(22px,5vw,32px)}
  .footer-grid{grid-template-columns:1fr 1fr}
  .footer-grid>div:first-child,.footer-grid>div:last-child{grid-column:1/-1}
  .app-demo{padding:0}
  .app-shell{width:100%;height:100dvh;border:0;border-radius:0;grid-template-columns:1fr}
  .app-sidebar{display:none}
  .app-topbar{height:92px;padding:14px 18px;padding-top:max(14px,env(safe-area-inset-top))}
  .app-view{height:calc(100dvh - 164px - env(safe-area-inset-bottom));padding:16px 14px 28px}
  .app-mobile-nav{display:flex;justify-content:flex-start;overflow-x:auto;height:calc(72px + env(safe-area-inset-bottom));padding-bottom:env(safe-area-inset-bottom);scrollbar-width:none}
  .app-mobile-nav::-webkit-scrollbar{display:none}
  .app-mobile-nav button{flex:1 0 74px;min-width:74px}
  .demo-grid{display:grid}
  .demo-deck-panel{min-height:620px}
  .demo-side-panel{display:flex}
  .messages-demo{grid-template-columns:1fr}
  .conversation-list{display:flex;gap:8px;overflow-x:auto;border-right:0;border-bottom:1px solid var(--line);padding:10px}
  .conversation-list button{flex:0 0 min(240px,78vw)}
  .social-demo{grid-template-columns:1fr}
  .explore-map{display:block;height:min(62svh,460px)}
  .plans-grid,.ticket-wallet{grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))}
}

@media (max-width:520px){
  :root{--shell:calc(100% - 20px)}
  .mobile-menu-actions{grid-template-columns:1fr}
  .hero h1{font-size:clamp(3.1rem,17vw,4.2rem)}
  .hero-lede{font-size:1rem}
  .hero-actions .button{width:100%}
  .hero-playground{min-height:clamp(500px,168vw,590px)}
  .phone-shell{width:min(330px,90vw);box-shadow:8px 10px 0 var(--ink)}
  .deck-actions{gap:8px}
  .round-action{width:44px;height:44px}
  .round-action--no{width:52px;height:52px}
  .round-action--yes{width:58px;height:58px}
  .sticker--arrow,.floating-bubble--match{display:none}
  .section-heading{display:block}
  .section-number{margin-bottom:18px}
  .bento-card{padding:22px}
  .person-card{grid-template-columns:78px minmax(0,1fr)}
  .person-card img{width:78px}
  .ticket{width:min(310px,88vw)}
  .final-cta__inner{padding:65px 18px}
  .final-cta__inner>div{flex-direction:column}
  .footer-grid{grid-template-columns:1fr}
  .footer-grid>div{grid-column:1!important}
  .modal{padding:24px 18px}
  .demo-deck-panel{min-height:560px}
  .demo-deck{height:520px;width:min(340px,94%)}
  .explore-list,.match-grid{grid-template-columns:1fr}
}

@media (max-width:360px){
  .phone-shell{width:94vw}
  .floating-bubble,.sticker--spark{display:none}
  .calendar-event{grid-template-columns:38px 46px minmax(0,1fr)}
  .calendar-event b{display:none}
}

@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{scroll-behavior:auto!important;animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}
  .reveal,.landing-js .reveal{opacity:1;transform:none}
}
`

const mobileMenu = `
      <div class="mobile-menu" id="mobile-menu">
        <nav aria-label="Mobile navigation"><a href="#how">How it works</a><a href="#social">Social</a><a href="#organizers">Organizers</a><a href="#safety">Safety</a></nav>
        <div class="mobile-menu-actions"><a class="button button--ghost" href="/signin">Sign In</a><a class="button button--ink" href="/signup">Register <span>↗</span></a></div>
      </div>`

const landingShellScript = `
    <script>
      (function () {
        function closeMobileMenu() {
          var header = document.querySelector('#site-header')
          var button = header && header.querySelector('.menu-button')
          if (!header || !button) return
          header.classList.remove('menu-open')
          button.setAttribute('aria-expanded', 'false')
        }

        document.addEventListener('DOMContentLoaded', function () {
          var header = document.querySelector('#site-header')
          var menu = document.querySelector('#mobile-menu')

          if (menu) {
            menu.querySelectorAll('a').forEach(function (link) {
              link.addEventListener('click', closeMobileMenu)
            })
          }

          document.addEventListener('click', function (event) {
            if (header && header.classList.contains('menu-open') && !header.contains(event.target)) closeMobileMenu()
          })

          document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') closeMobileMenu()
          })

          var desktopQuery = window.matchMedia('(min-width: 1101px)')
          if (desktopQuery.addEventListener) {
            desktopQuery.addEventListener('change', function (event) {
              if (event.matches) closeMobileMenu()
            })
          }
        }, { once: true })
      })()
    </script>
    <script src="/landing-demo.js?v=2" defer></script>`

function restoreLanding(source) {
  let html = source

  html = html.replace(
    '<link rel="stylesheet" href="/styles.css?v=1" />',
    '<link rel="stylesheet" href="/styles.css?v=2" />'
  )

  html = html.replace(
    '</head>',
    `    <script>document.documentElement.classList.add('landing-js')</script>\n    <style>${landingStyles}</style>\n  </head>`
  )

  html = html.replace(
    '<div class="header-actions"><button class="button button--ghost" data-open-modal="waitlist">Join waitlist</button><button class="button button--ink" data-open-app>Open Puddle <span>↗</span></button></div>',
    '<div class="header-actions"><a class="button button--ghost" href="/signin">Sign In</a><a class="button button--ink" href="/signup">Register <span>↗</span></a></div>'
  )

  html = html.replace(
    '<button class="menu-button" type="button" aria-label="Open menu" aria-expanded="false"><span></span><span></span></button>',
    '<button class="menu-button" type="button" aria-label="Open menu" aria-controls="mobile-menu" aria-expanded="false"><span></span><span></span></button>' + mobileMenu
  )

  html = html.replace(
    '<button class="button button--ink button--large" data-open-app>Open Puddle <span>→</span></button><button class="button button--cream button--large" data-open-modal="waitlist">Join the beta</button>',
    '<button class="button button--ink button--large" data-open-app>Try the Puddle demo <span>→</span></button><a class="button button--cream button--large" href="/signup">Join the beta</a>'
  )

  html = html.replace(
    /<div><strong>Get early access<\/strong><form class="footer-form" data-waitlist-form>[\s\S]*?<small>No spam\. Just launch updates and good plans\.<\/small><\/div>/,
    '<div><strong>Create your account</strong><form class="footer-form" action="/signup" method="get"><input name="email" type="email" required placeholder="you@email.com" aria-label="Email address" /><button type="submit" aria-label="Continue to registration">→</button></form><small>Already registered? <a href="/signin">Sign In</a>.</small></div>'
  )

  html = html.replace(
    '<button data-app-view="messages">✉<span>Chat</span></button></nav>',
    '<button data-app-view="messages">✉<span>Chat</span></button><button data-app-view="tickets">▤<span>Tickets</span></button></nav>'
  )

  html = html.replace('<script src="/app.js?v=1" defer></script>', landingShellScript)
  return html
}

export async function GET() {
  const source = await readFile(landingPath, 'utf8')
  const html = restoreLanding(source)

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0'
    }
  })
}
