function route() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  let html
  if (path === '/') html = homePage()
  else if (path === '/signin') html = authChoice('signin')
  else if (path === '/signup') html = authChoice('signup')
  else if (path === '/signin/student') html = authForm('signin', 'student')
  else if (path === '/signin/business') html = authForm('signin', 'business')
  else if (path === '/signup/student') html = authForm('signup', 'student')
  else if (path === '/signup/business') html = authForm('signup', 'business')
  else if (path === '/help') html = helpPage()
  else if (path === '/terms') html = termsPage()
  else if (path === '/privacy') html = privacyPage()
  else html = notFoundPage()

  app.innerHTML = html
  bindInteractions()
  document.title = path === '/' ? 'Valantir | Volunteer opportunities for Ontario students' : `${document.querySelector('h1')?.textContent || 'Valantir'} · Valantir`
  if (window.location.hash) requestAnimationFrame(() => document.querySelector(window.location.hash)?.scrollIntoView())
  else window.scrollTo(0, 0)
}

function bindInteractions() {
  const menu = document.querySelector('.menu-button')
  const panel = document.querySelector('.header-panel')
  menu?.addEventListener('click', () => {
    const open = panel?.classList.toggle('is-open') || false
    menu.setAttribute('aria-expanded', String(open))
  })

  const newsletter = document.querySelector('.newsletter')
  newsletter?.addEventListener('submit', event => {
    event.preventDefault()
    newsletter.querySelector('.form-note')?.classList.add('is-visible')
  })

  document.querySelectorAll('.faq-item button').forEach(button => {
    button.addEventListener('click', () => {
      const item = button.closest('.faq-item')
      const open = item?.classList.toggle('is-open') || false
      button.setAttribute('aria-expanded', String(open))
      const indicator = button.lastElementChild
      if (indicator) indicator.textContent = open ? '−' : '+'
    })
  })

  document.querySelector('.account-form')?.addEventListener('submit', event => {
    event.preventDefault()
    const message = document.querySelector('.demo-message')
    if (message) message.hidden = false
  })

  if (typeof mountHeroMotion === 'function') mountHeroMotion()
}

window.addEventListener('popstate', route)
route()
