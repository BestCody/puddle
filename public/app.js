const registrationPath = '/signup'
const signInPath = '/signin'
const privacyPath = '/privacy'
const termsPath = '/terms'

const events = [
  { title:'Neon Garden', category:'Nightlife', date:'Fri · 10:00 PM', place:'Stackt Market · 2.4 km', price:'$24', image:'/events/neon-night.svg', description:'A glowing indoor garden, live DJs and surreal installations until late.', match:'98% your vibe' },
  { title:'Clay & Cabernet', category:'Workshop', date:'Sat · 6:30 PM', place:'Dundas West · 3.1 km', price:'$38', image:'/events/ceramics.svg', description:'Make a wonky cup, drink something good and meet people who also need a hobby.', match:'Creative pick' },
  { title:'Rooftop Cinema Club', category:'Film', date:'Sun · 8:45 PM', place:'King West · 1.8 km', price:'$18', image:'/events/rooftop.svg', description:'Cult classics, city lights, popcorn and blankets above the skyline.', match:'Because you saved film' },
  { title:'Late Night Jazz Club', category:'Live music', date:'Thu · 9:00 PM', place:'The Annex · 4.2 km', price:'$16', image:'/events/jazz.svg', description:'A tiny room, warm lights and three sets from Toronto’s newest jazz players.', match:'92% your vibe' }
]

const modalCopy = {
  organizer: ['Organizer tools without the spreadsheet sprawl.', 'Create drafts, manage attendees, publish updates, review performance, and keep private venue details out of public records.'],
  safety: ['Safety is part of the product, not a footer promise.', 'Puddle combines visibility controls, age restrictions, expiring location sharing, reporting, evidence preservation, and role-gated moderation workflows.']
}

let currentIndex = 0
const history = []
const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

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
  if (headerSignInButton) replaceButtonWithLink(headerSignInButton, 'Sign In', signInPath)
  document.querySelectorAll('.header-actions [data-open-app]').forEach((button) => {
    replaceButtonWithLink(button, 'Register', registrationPath, '↗')
  })
  document.querySelectorAll('[data-open-app]').forEach((button) => replaceButtonWithLink(button, button.textContent.trim() || 'Register', registrationPath))
  document.querySelectorAll('[data-open-modal="waitlist"]').forEach((button) => replaceButtonWithLink(button, 'Sign Up', registrationPath))
  document.querySelectorAll('[data-open-modal="privacy"]').forEach((button) => replaceButtonWithLink(button, 'Privacy', privacyPath))
  document.querySelectorAll('[data-open-modal="terms"]').forEach((button) => replaceButtonWithLink(button, 'Terms', termsPath))

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
      window.location.assign(email ? `${registrationPath}?email=${encodeURIComponent(email)}` : registrationPath)
    })
  }
}

function cardElement(item, stackIndex) {
  const card = document.createElement('article')
  card.className = 'event-card'
  card.style.zIndex = String(20 - stackIndex)
  card.tabIndex = stackIndex === 0 ? 0 : -1
  card.setAttribute('aria-label', `${item.title}, ${item.date}`)

  const imageArea = document.createElement('div')
  imageArea.className = 'event-card__image'
  const image = document.createElement('img')
  image.src = item.image
  image.alt = `${item.title} event artwork`
  image.draggable = false
  image.decoding = 'async'
  imageArea.appendChild(image)

  const badges = document.createElement('div')
  badges.className = 'event-card__badges'
  for (const text of [item.category, item.match]) {
    const badge = document.createElement('span')
    badge.className = 'badge'
    badge.textContent = text
    badges.appendChild(badge)
  }
  imageArea.appendChild(badges)

  const body = document.createElement('div')
  body.className = 'event-card__body'
  const meta = document.createElement('div')
  meta.className = 'event-card__meta'
  const date = document.createElement('span')
  date.textContent = item.date
  const distance = document.createElement('span')
  distance.textContent = `• ${item.place.split('·')[1]?.trim() || 'nearby'}`
  meta.append(date, distance)
  const title = document.createElement('h3')
  title.textContent = item.title
  const description = document.createElement('p')
  description.textContent = item.description
  const footer = document.createElement('div')
  footer.className = 'event-card__footer'
  const hint = document.createElement('span')
  hint.className = 'event-card__friends'
  hint.textContent = 'Swipe to explore'
  const price = document.createElement('span')
  price.className = 'event-card__price'
  price.textContent = item.price
  footer.append(hint, price)
  body.append(meta, title, description, footer)
  card.append(imageArea, body)
  attachDrag(card)
  return card
}

function renderDeck() {
  const deck = $('#hero-deck')
  if (!deck) return
  deck.replaceChildren()
  const visible = [0, 1, 2].map((offset) => events[(currentIndex + offset) % events.length])
  visible.reverse().forEach((item, index) => deck.appendChild(cardElement(item, visible.length - 1 - index)))
}

function completeSwipe(direction) {
  const card = $('#hero-deck .event-card:last-child')
  if (!card) return
  history.push(currentIndex)
  const x = direction === 'right' ? window.innerWidth : -window.innerWidth
  card.style.transform = `translateX(${x}px) rotate(${direction === 'right' ? 22 : -22}deg)`
  card.style.opacity = '0'
  window.setTimeout(() => { currentIndex = (currentIndex + 1) % events.length; renderDeck() }, 260)
}

function undo() {
  const previous = history.pop()
  if (previous === undefined) return
  currentIndex = previous
  renderDeck()
}

function attachDrag(card) {
  let startX = 0
  let currentX = 0
  let dragging = false
  card.addEventListener('pointerdown', (event) => { dragging = true; startX = event.clientX; card.setPointerCapture(event.pointerId); card.style.transition = 'none' })
  card.addEventListener('pointermove', (event) => { if (!dragging) return; currentX = event.clientX - startX; card.style.transform = `translateX(${currentX}px) rotate(${currentX / 18}deg)` })
  card.addEventListener('pointerup', () => { if (!dragging) return; dragging = false; card.style.transition = ''; if (Math.abs(currentX) > 85) completeSwipe(currentX > 0 ? 'right' : 'left'); else card.style.transform = ''; currentX = 0 })
  card.addEventListener('keydown', (event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); completeSwipe(event.key === 'ArrowRight' ? 'right' : 'left') } })
}

function openModal(type) {
  const copy = modalCopy[type]
  const backdrop = $('#modal-backdrop')
  const content = $('#modal-content')
  if (!copy || !backdrop || !content) return
  content.replaceChildren()
  const title = document.createElement('h2')
  title.id = 'modal-title'
  title.textContent = copy[0]
  const paragraph = document.createElement('p')
  paragraph.textContent = copy[1]
  content.append(title, paragraph)
  backdrop.classList.add('is-open')
  backdrop.setAttribute('aria-hidden', 'false')
  $('[data-close-modal]', backdrop)?.focus()
}

function closeModal() {
  const backdrop = $('#modal-backdrop')
  backdrop?.classList.remove('is-open')
  backdrop?.setAttribute('aria-hidden', 'true')
}

function optimizeImages() {
  $$('img').forEach((image, index) => {
    image.decoding = 'async'
    if (index > 6) image.loading = 'lazy'
  })
}

function initLanding() {
  $('#app-demo')?.remove()
  $('#toast-region')?.remove()
  $('#confetti-layer')?.remove()
  connectLandingToAuthentication()
  renderDeck()
  optimizeImages()
  $$('[data-swipe]').forEach((button) => button.addEventListener('click', () => button.dataset.swipe === 'undo' ? undo() : completeSwipe(button.dataset.swipe)))
  $$('.mini-like').forEach((button) => button.addEventListener('click', () => { button.classList.toggle('is-liked'); button.setAttribute('aria-pressed', String(button.classList.contains('is-liked'))) }))
  $$('[data-open-modal]').forEach((button) => button.addEventListener('click', () => openModal(button.dataset.openModal)))
  $$('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal))
  $('#modal-backdrop')?.addEventListener('click', (event) => { if (event.target.id === 'modal-backdrop') closeModal() })
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal() })
  $('.menu-button')?.addEventListener('click', (event) => { const header = $('#site-header'); const open = header.classList.toggle('menu-open'); event.currentTarget.setAttribute('aria-expanded', String(open)) })
  window.addEventListener('scroll', () => $('#site-header')?.classList.toggle('is-scrolled', window.scrollY > 20), { passive: true })
  const revealObserver = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add('is-visible'); revealObserver.unobserve(entry.target) } }), { threshold: .12 })
  $$('.reveal').forEach((element) => revealObserver.observe(element))
  const countObserver = new IntersectionObserver((entries) => entries.forEach((entry) => { if (!entry.isIntersecting) return; const element = entry.target; const target = Number(element.dataset.count); element.textContent = target.toLocaleString(); countObserver.unobserve(element) }), { threshold: .5 })
  $$('[data-count]').forEach((element) => countObserver.observe(element))
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLanding, { once: true })
else initLanding()
