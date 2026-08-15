const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

function activeLandingStage() {
  return window.matchMedia('(max-width: 760px)').matches
    ? $('.landing-stage--mobile')
    : $('.landing-stage--desktop')
}

function fitLanding() {
  const mobile = window.matchMedia('(max-width: 760px)').matches
  const desktopStage = $('.landing-stage--desktop')
  const mobileStage = $('.landing-stage--mobile')
  const desktopCanvas = $('.landing-canvas--desktop')
  const mobileCanvas = $('.landing-canvas--mobile')
  if (!desktopStage || !mobileStage || !desktopCanvas || !mobileCanvas) return

  const desktopScale = Math.min(window.innerWidth / 1281, 1, (window.innerHeight * 1.425) / 1281)
  const mobileScale = Math.min(window.innerWidth / 704, 1)

  const setScale = (stage, canvas, nativeWidth, nativeHeight, scale) => {
    stage.style.width = `${nativeWidth * scale}px`
    stage.style.height = `${nativeHeight * scale}px`
    canvas.style.transform = `scale(${scale})`
    canvas.dataset.scale = String(scale)
  }

  setScale(desktopStage, desktopCanvas, 1281, 8736, desktopScale)
  setScale(mobileStage, mobileCanvas, 704, 9660, mobileScale)
  document.documentElement.dataset.landingMode = mobile ? 'mobile' : 'desktop'
}

function protectInteractiveLayers() {
  $$('.trust-heading, .final-cta').forEach((section) => {
    section.style.pointerEvents = 'none'
  })
  $$('.final-cta > a').forEach((link) => {
    link.style.pointerEvents = 'auto'
  })
}

function updateMobileJump() {
  const canvas = $('.landing-canvas--mobile')
  const jump = $('.mobile-jump')
  if (!canvas || !jump) return
  const visible = window.scrollY > 24
  canvas.classList.toggle('is-scrolled', visible)
  jump.setAttribute('aria-hidden', visible ? 'false' : 'true')
  if (visible) jump.removeAttribute('tabindex')
  else jump.setAttribute('tabindex', '-1')
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

const phoneDemoByAsset = new Map([
  ['phone-swipe.png', ['swipe', 'Interactive Puddle Swipe demo']],
  ['phone-save.png', ['save', 'Interactive Puddle Saved demo']],
  ['phone-feed.png', ['feed', 'Interactive Puddle Feed demo']],
  ['phone-profile.png', ['profile', 'Interactive Puddle Profile demo']]
])

function initInteractivePhoneDemos() {
  $$('.feature-phone[src]').forEach((placeholder) => {
    const asset = String(placeholder.getAttribute('src') || '').split('/').pop()
    const demo = phoneDemoByAsset.get(asset)
    if (!demo) return
    const [view, title] = demo
    const shell = document.createElement('div')
    shell.className = `feature-phone feature-phone-demo feature-phone-demo--${view}`
    shell.dataset.phoneDemo = view
    shell.setAttribute('role', 'group')
    shell.setAttribute('aria-label', title)

    const frame = document.createElement('iframe')
    frame.className = 'feature-phone-demo__frame'
    frame.dataset.src = `/landing-demo/${view}`
    frame.title = title
    frame.referrerPolicy = 'same-origin'
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups')
    frame.setAttribute('allow', 'clipboard-write')

    shell.append(frame)
    placeholder.replaceWith(shell)
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
      const canvas = phone.closest('.landing-canvas')
      const scale = Number(canvas?.dataset.scale || 1) || 1
      dx = Math.max(-45, Math.min(45, (event.clientX - startX) / scale))
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
  fitLanding()
  protectInteractiveLayers()
  updateMobileJump()
  initInteractivePhoneDemos()
  initPhoneDemoLoading()
  window.addEventListener('resize', fitLanding, { passive: true })
  window.addEventListener('orientationchange', fitLanding, { passive: true })
  window.addEventListener('scroll', updateMobileJump, { passive: true })

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
