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

function initLandingAuth() {
  const params = new URLSearchParams(window.location.search)
  const next = params.get('next')
  const nextField = $('.landing-login-form [name="next"]')
  if (next && nextField) nextField.value = next

  const message = params.get('error')
  if (message) {
    $$('[data-landing-auth-message]').forEach((target) => {
      target.textContent = message
      target.hidden = false
    })
  }

  const panel = $('.login-panel')
  if (!panel) return

  const mobileLoginButton = $('[data-mobile-login-trigger]')
  const mobileLoginDialog = $('#mobile-login-dialog')
  const mobileLoginSurface = $('.mobile-login-dialog__surface', mobileLoginDialog)
  const mobileLoginClose = $('[data-close-mobile-login]', mobileLoginDialog)
  const originalPanelParent = panel.parentNode
  const originalPanelNextSibling = panel.nextSibling

  const modeButtons = $$('.auth-mode-switch [data-auth-mode]', panel)
  const loginForm = $('.landing-login-form', panel)
  const signupForm = $('.landing-signup-form', panel)
  const loginAlternatives = $('.landing-login-alternatives', panel)
  const forgotLink = $('.login-forgot', panel)
  if (!modeButtons.length || !loginForm || !signupForm) return

  const setMode = (mode, focus = false) => {
    const signup = mode === 'signup'
    panel.dataset.authMode = signup ? 'signup' : 'login'
    panel.setAttribute('aria-label', signup ? 'Sign up' : 'Log in')
    loginForm.hidden = signup
    signupForm.hidden = !signup
    if (loginAlternatives) loginAlternatives.hidden = signup
    if (forgotLink) forgotLink.hidden = signup

    modeButtons.forEach((button) => {
      const selected = button.dataset.authMode === (signup ? 'signup' : 'login')
      button.setAttribute('aria-selected', String(selected))
      button.tabIndex = selected ? 0 : -1
    })

    if (focus) {
      const target = signup ? $('#landing-signup-display-name', signupForm) : $('#landing-email', loginForm)
      target?.focus()
    }
  }

  modeButtons.forEach((button, index) => {
    button.addEventListener('click', () => setMode(button.dataset.authMode, true))
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const direction = event.key === 'ArrowLeft' || event.key === 'Home' ? -1 : 1
      const nextIndex = event.key === 'Home' || event.key === 'End'
        ? (event.key === 'Home' ? 0 : modeButtons.length - 1)
        : (index + direction + modeButtons.length) % modeButtons.length
      const nextButton = modeButtons[nextIndex]
      nextButton.focus()
      setMode(nextButton.dataset.authMode)
    })
  })

  const restorePanel = () => {
    if (!originalPanelParent || panel.parentNode === originalPanelParent) return
    originalPanelParent.insertBefore(panel, originalPanelNextSibling && originalPanelNextSibling.parentNode === originalPanelParent ? originalPanelNextSibling : null)
  }

  const openMobileLogin = (focus = true) => {
    if (!mobileLoginDialog || !mobileLoginSurface || typeof mobileLoginDialog.showModal !== 'function') return false
    mobileLoginSurface.append(panel)
    if (!mobileLoginDialog.open) mobileLoginDialog.showModal()
    setMode('login', focus)
    return true
  }

  mobileLoginButton?.addEventListener('click', (event) => {
    if (!window.matchMedia('(max-width: 760px)').matches || !openMobileLogin()) return
    event.preventDefault()
  })
  mobileLoginClose?.addEventListener('click', () => mobileLoginDialog?.close())
  mobileLoginDialog?.addEventListener('click', (event) => {
    if (event.target === mobileLoginDialog) mobileLoginDialog.close()
  })
  mobileLoginDialog?.addEventListener('close', () => {
    restorePanel()
    mobileLoginButton?.focus()
  })

  setMode(params.get('mode') === 'signup' ? 'signup' : 'login')
  if (params.get('mode') === 'login' && window.matchMedia('(max-width: 760px)').matches) openMobileLogin()
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

  initLandingAuth()
  initDraggablePhones()

  requestAnimationFrame(() => {
    const stage = activeLandingStage()
    if (stage) stage.dataset.ready = 'true'
  })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLanding, { once: true })
else initLanding()
