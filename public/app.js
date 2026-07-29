const registrationPath = '/signup'
const signInPath = '/signin'
let domContentLoaded = false

document.addEventListener('DOMContentLoaded', () => {
  domContentLoaded = true
}, { once: true })

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
  const primaryNav = document.querySelector('.desktop-nav')
  if (primaryNav && !primaryNav.querySelector('[data-auth-signin]')) {
    const signInLink = document.createElement('a')
    signInLink.href = signInPath
    signInLink.dataset.authSignin = 'true'
    signInLink.textContent = 'Sign in'
    primaryNav.appendChild(signInLink)
  }

  document.querySelectorAll('[data-open-modal="waitlist"]').forEach((button) => {
    replaceButtonWithLink(button, 'Sign Up', registrationPath)
  })

  document.querySelectorAll('[data-open-app]').forEach((button) => {
    const arrow = button.querySelector('span')?.textContent?.trim() || '→'
    replaceButtonWithLink(button, 'Register', registrationPath, arrow)
  })

  const footerForm = document.querySelector('.footer-form[data-waitlist-form]')
  if (footerForm) {
    footerForm.removeAttribute('data-waitlist-form')
    const footerColumn = footerForm.parentElement
    const heading = footerColumn?.querySelector('strong')
    const helper = footerColumn?.querySelector('small')
    if (heading) heading.textContent = 'Create your account'
    if (helper) helper.textContent = 'Already registered? Sign in from the navigation above.'

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

connectLandingToAuthentication()

const demoScript = document.createElement('script')
demoScript.src = '/landing-demo.js?v=1'
demoScript.onload = () => {
  if (domContentLoaded) document.dispatchEvent(new Event('DOMContentLoaded'))
}
document.head.appendChild(demoScript)
