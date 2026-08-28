const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

function activeLandingStage() {
  return window.matchMedia('(max-width: 760px)').matches
    ? $('.landing-stage--mobile')
    : $('.landing-stage--desktop')
}

function protectInteractiveLayers() {
  $$('.trust-heading, .final-cta').forEach((section) => {
    section.style.pointerEvents = 'none'
  })
  $$('.final-cta > a').forEach((link) => {
    link.style.pointerEvents = 'auto'
  })
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

function initSignInHandoff() {
  $$('[data-signin-handoff]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      window.location.assign('/signin')
    })
  })
}

function initPhoneDemoLoading() {
  const frames = $$('.feature-phone-demo__frame')
  if (!frames.length) return

  const loadFrame = (frame) => {
    if (frame.dataset.loaded === 'true') return
    const source = frame.dataset.src || frame.getAttribute('src')
    if (!source || source === 'about:blank') return
    frame.dataset.src = source
    frame.loading = 'eager'
    frame.src = source
    frame.dataset.loaded = 'true'
  }

  frames.forEach((frame) => {
    const source = frame.dataset.src || frame.getAttribute('src')
    if (!source || source === 'about:blank') return
    frame.dataset.src = source
    frame.removeAttribute('src')
  })

  if (!('IntersectionObserver' in window)) {
    frames.forEach(loadFrame)
    return
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      const frame = entry.target.querySelector('.feature-phone-demo__frame')
      if (frame) loadFrame(frame)
      observer.unobserve(entry.target)
    })
  }, { root: null, rootMargin: '500px 0px', threshold: 0.01 })

  $$('.feature-phone-demo').forEach((shell) => observer.observe(shell))
}

function initDraggablePhones() {
  $$('[data-draggable-phone]').forEach((phone) => {
    let pointerId = null
    let startX = 0
    let dx = 0

    const reset = () => {
      if (pointerId !== null && phone.hasPointerCapture?.(pointerId)) phone.releasePointerCapture(pointerId)
      pointerId = null
      phone.classList.remove('is-dragging')
      phone.style.transform = ''
    }

    phone.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      pointerId = event.pointerId
      startX = event.clientX
      dx = 0
      phone.setPointerCapture?.(pointerId)
      phone.classList.add('is-dragging')
    })

    phone.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return
      dx = Math.max(-45, Math.min(45, event.clientX - startX))
      phone.style.transform = `translateX(${dx}px) rotate(${dx * 0.035}deg)`
    })

    phone.addEventListener('pointerup', reset)
    phone.addEventListener('pointercancel', reset)
    phone.addEventListener('lostpointercapture', () => {
      if (pointerId !== null) reset()
    })
  })
}

function initLanding() {
  protectInteractiveLayers()
  initPhoneDemoLoading()

  $$('[data-open-safety]').forEach((button) => button.addEventListener('click', openSafetyDialog))
  $$('[data-close-safety]').forEach((button) => button.addEventListener('click', closeSafetyDialog))

  $('#safety-dialog-backdrop')?.addEventListener('click', (event) => {
    if (event.target.id === 'safety-dialog-backdrop') closeSafetyDialog()
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSafetyDialog()
  })

  initSignInHandoff()
  initDraggablePhones()

  requestAnimationFrame(() => {
    const stage = activeLandingStage()
    if (stage) stage.dataset.ready = 'true'
  })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLanding, { once: true })
else initLanding()
