(() => {
  let recoveryAttempted = false

  function closeMobileMenu() {
    const header = document.querySelector('#site-header')
    const button = document.querySelector('.menu-button')
    if (!header || !button) return
    header.classList.remove('menu-open')
    button.setAttribute('aria-expanded', 'false')
  }

  function enhanceMobileMenu() {
    const header = document.querySelector('#site-header')
    const menu = document.querySelector('#mobile-menu')
    if (!header || !menu || menu.dataset.enhanced === 'true') return
    menu.dataset.enhanced = 'true'

    menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMobileMenu))
    document.addEventListener('pointerdown', (event) => {
      if (!header.classList.contains('menu-open') || header.contains(event.target)) return
      closeMobileMenu()
    })
  }

  function ensureInteractiveLanding() {
    enhanceMobileMenu()

    const deck = document.querySelector('#hero-deck')
    if (deck?.querySelector('.event-card')) return
    if (recoveryAttempted || typeof window.init !== 'function') return

    recoveryAttempted = true
    window.init()
  }

  function start() {
    window.setTimeout(ensureInteractiveLanding, 0)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }

  window.addEventListener('load', start, { once: true })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMobileMenu()
  })
})()
