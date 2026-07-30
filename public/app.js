const registrationPath = '/signup'
const signInPath = '/signin'

function replaceButtonWithLink(element, label, href, arrow = '') {
  const link = document.createElement('a')
  link.className = element.className
  link.href = href
  link.textContent = label

  if (arrow) {
    link.append(' ')
    const arrowElement = document.createElement('span')
    arrowElement.textContent = arrow
    link.appendChild(arrowElement)
  }

  const ariaLabel = element.getAttribute('aria-label')
  if (ariaLabel) link.setAttribute('aria-label', ariaLabel)
  element.replaceWith(link)
  return link
}

function connectLandingToAuthentication() {
  const headerSignInButton = document.querySelector('.header-actions [data-open-modal="waitlist"]')
  if (headerSignInButton) {
    replaceButtonWithLink(headerSignInButton, 'Sign In', signInPath)
  }

  document.querySelectorAll('.header-actions [data-open-app]').forEach((button) => {
    replaceButtonWithLink(button, 'Register', registrationPath, '↗')
  })

  document.querySelectorAll('[data-open-modal="waitlist"]').forEach((button) => {
    replaceButtonWithLink(button, 'Sign Up', registrationPath)
  })

  const footerForm = document.querySelector('.footer-form[data-waitlist-form]')
  if (footerForm) {
    footerForm.removeAttribute('data-waitlist-form')
    const footerColumn = footerForm.parentElement
    const heading = footerColumn?.querySelector('strong')
    const helper = footerColumn?.querySelector('small')
    if (heading) heading.textContent = 'Create your account'
    if (helper) helper.textContent = 'Already registered? Use Sign In at the top of the page.'

    footerForm.addEventListener('submit', (event) => {
      event.preventDefault()
      const email = footerForm.querySelector('input[type="email"]')?.value?.trim() || ''
      const destination = email
        ? `${registrationPath}?email=${encodeURIComponent(email)}`
        : registrationPath
      window.location.assign(destination)
    })
  }
}

function disableLandingNotifications() {
  window.toast = () => {}
  document.querySelector('#toast-region')?.remove()
}

function loadInteractiveLanding() {
  const originalAddEventListener = document.addEventListener.bind(document)
  const pendingDomReadyListeners = []

  document.addEventListener = function addEventListener(type, listener, options) {
    if (type === 'DOMContentLoaded') {
      pendingDomReadyListeners.push(listener)
      return
    }
    return originalAddEventListener(type, listener, options)
  }

  const demoScript = document.createElement('script')
  demoScript.src = '/landing-demo.js?v=4'
  demoScript.dataset.landingDemo = 'true'

  demoScript.onload = () => {
    document.addEventListener = originalAddEventListener
    disableLandingNotifications()
    const event = new Event('DOMContentLoaded')

    pendingDomReadyListeners.forEach((listener) => {
      if (typeof listener === 'function') listener.call(document, event)
      else listener?.handleEvent?.(event)
    })

    requestAnimationFrame(() => {
      if (!document.querySelector('#hero-deck .event-card')) {
        document.documentElement.dataset.landingError = 'deck-not-initialized'
        console.error('Puddle landing deck failed to initialize')
      }
    })
  }

  demoScript.onerror = () => {
    document.addEventListener = originalAddEventListener
    document.documentElement.dataset.landingError = 'demo-script-failed'
    console.error('Puddle landing demo script failed to load')
  }

  document.head.appendChild(demoScript)
}

connectLandingToAuthentication()
disableLandingNotifications()
loadInteractiveLanding()
