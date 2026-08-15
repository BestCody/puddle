// Landing visuals are sourced directly from the exact desktop and mobile Figma artboards.
const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

function revealMobileJumpIn() {
  const mobile = $('.figma-artboard--mobile')
  if (!mobile) return
  if (window.scrollY > 0) mobile.classList.add('has-scrolled')
}

function openSafetyDialog() {
  const backdrop = $('#safety-dialog-backdrop')
  if (!backdrop) return
  backdrop.classList.add('is-open')
  backdrop.setAttribute('aria-hidden', 'false')
  $('[data-close-safety]', backdrop)?.focus()
}

function closeSafetyDialog() {
  const backdrop = $('#safety-dialog-backdrop')
  if (!backdrop) return
  backdrop.classList.remove('is-open')
  backdrop.setAttribute('aria-hidden', 'true')
}

function initLanding() {
  revealMobileJumpIn()
  window.addEventListener('scroll', revealMobileJumpIn, { passive: true, once: true })

  $$('[data-open-safety]').forEach((button) => button.addEventListener('click', openSafetyDialog))
  $$('[data-close-safety]').forEach((button) => button.addEventListener('click', closeSafetyDialog))

  $('#safety-dialog-backdrop')?.addEventListener('click', (event) => {
    if (event.target.id === 'safety-dialog-backdrop') closeSafetyDialog()
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSafetyDialog()
  })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLanding, { once: true })
else initLanding()
