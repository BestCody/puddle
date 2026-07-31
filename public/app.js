const registrationPath = '/signup'
const signInPath = '/signin'
const privacyPath = '/privacy'
const termsPath = '/terms'

const events = [
  { title:'Moonlight Café', category:'Coffee date', date:'Open late', place:'Queen West · 1.5 km', price:'$$', image:'/events/jazz.svg', description:'Late-night espresso, vinyl, soft lights, and enough quiet to actually talk.', match:'Easy conversation' },
  { title:'Clay & Cabernet', category:'Activity date', date:'Saturday evenings', place:'Dundas West · 3.1 km', price:'$$$', image:'/events/ceramics.svg', description:'Make something slightly wonky together, with wine and alcohol-free drinks available.', match:'Playful pick' },
  { title:'Rooftop Cinema Club', category:'Movie date', date:'Sunset screenings', place:'King West · 1.8 km', price:'$$', image:'/events/rooftop.svg', description:'Cult classics, skyline views, popcorn, and blankets above the city.', match:'Great second stop' },
  { title:'Neon Garden Lounge', category:'Evening date', date:'Open until 1 AM', place:'The Junction · 4.2 km', price:'$$$', image:'/events/neon-night.svg', description:'A glowing indoor garden with small plates, mocktails, and tucked-away booths.', match:'Romantic atmosphere' }
]

const modalCopy = {
  organizer: ['Puddle is built around choosing the place together.', 'Swipe through nearby date locations, save your favourites, share a shortlist, and turn the best option into a real plan.'],
  safety: ['Date ideas without matching strangers.', 'Puddle recommends places—not people—and gives you privacy controls, blocking, reporting, and time-limited location sharing for plans you choose to make.']
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

function setText(selector, text, root = document) {
  const element = root.querySelector(selector)
  if (element) element.textContent = text
}

function updateMeta(selector, content) {
  const element = document.querySelector(selector)
  if (element) element.setAttribute('content', content)
}

function alignLandingToDateLocations() {
  document.title = 'Puddle — swipe for your next date spot'
  updateMeta('meta[name="description"]', 'Swipe through nearby places and save locations that feel right for a date.')
  updateMeta('meta[property="og:title"]', 'Puddle — find a date spot by swiping')
  updateMeta('meta[property="og:description"]', 'Coffee shops, restaurants, activity dates, scenic spots and more—one place at a time.')

  const navItems = $$('.desktop-nav a')
  const navCopy = [
    ['How it works', '#how'],
    ['Date ideas', '#how'],
    ['Safety', '#safety']
  ]
  navItems.forEach((item, index) => {
    const next = navCopy[index]
    if (!next) return
    item.textContent = next[0]
    item.href = next[1]
  })
  navItems.slice(navCopy.length).forEach((item) => item.remove())

  setText('.hero .eyebrow', 'Toronto beta · made for better dates')
  const heroTitle = $('.hero-copy h1')
  if (heroTitle) heroTitle.innerHTML = 'Find the date spot <em>one swipe</em> at a time.'
  setText('.hero-lede', 'Coffee shops, restaurants, parks, galleries, activity dates and hidden gems nearby—served as a deck you can actually swipe through.')
  setText('.social-proof p strong', 'Skip the “where should we go?” spiral.')
  const socialProof = $('.social-proof p')
  if (socialProof) socialProof.lastChild.textContent = ' Save places that feel right and share the shortlist.'

  const playground = $('.hero-playground')
  if (playground) playground.setAttribute('aria-label', 'Interactive Puddle date-location deck')
  setText('.sticker--spark', '♡ date night?')
  setText('.sticker--arrow', 'swipe a place ↘')
  setText('.floating-bubble--friends', 'send it to your date')
  setText('.floating-bubble--match', 'great for conversation')
  setText('.round-action--no', '×')
  $('.round-action--no')?.setAttribute('aria-label', 'Pass on this location')
  $('.round-action--yes')?.setAttribute('aria-label', 'Save this location for a date')
  $('.round-action--share')?.setAttribute('aria-label', 'Share date location')

  const categories = ['COFFEE DATES ♡','DINNER DATES ♡','ACTIVITY DATES ♡','PARKS & GARDENS ♡','MUSEUMS ♡','SCENIC SPOTS ♡','DESSERT SPOTS ♡']
  $$('.marquee-track span').forEach((element, index) => { element.textContent = categories[index % categories.length] })
  $('.marquee')?.setAttribute('aria-label', 'Date location categories')

  setText('#how .section-heading .eyebrow', 'No endless review tabs')
  setText('#how .section-heading h2', 'Choosing the place should feel fun.')
  const howParagraph = $('#how .section-heading > p')
  if (howParagraph) howParagraph.textContent = 'Tell Puddle what kinds of date locations you like. Every pass and save sharpens the next deck while keeping enough variety to surprise you.'

  const bentoCards = $$('#how .bento-card')
  if (bentoCards[0]) {
    setText('.bento-kicker', 'Swipe', bentoCards[0])
    setText('h3', 'One nearby date spot at a time.', bentoCards[0])
    setText('p', 'Pass, save, inspect details, or share without leaving the swipe page.', bentoCards[0])
  }
  if (bentoCards[1]) {
    setText('.bento-kicker', 'Choose', bentoCards[1])
    setText('h3', 'Filter for the date you have in mind.', bentoCards[1])
    setText('.map-card strong', 'Date ideas near you', bentoCards[1])
    setText('.map-card span', 'within your travel radius', bentoCards[1])
  }
  if (bentoCards[2]) {
    setText('.bento-kicker', 'Plan', bentoCards[2])
    setText('h3', 'Turn a saved place into a real date.', bentoCards[2])
    setText('.calendar-event strong', 'Dinner, then a sunset walk', bentoCards[2])
    setText('.calendar-event b', 'saved', bentoCards[2])
  }

  $('#social')?.remove()
  $('#organizers')?.remove()
  $('.section--tickets')?.remove()

  setText('#safety .eyebrow', 'Places, not people')
  setText('#safety h2', 'Date discovery without stranger matching.')
  setText('#safety .safety-copy > p:not(.eyebrow)', 'Puddle helps you choose where to go. It does not match you with strangers, and sharing a plan or temporary location is always optional and controlled by you.')

  const footerHeading = $('.footer-form')?.parentElement?.querySelector('strong')
  const footerHelper = $('.footer-form')?.parentElement?.querySelector('small')
  if (footerHeading) footerHeading.textContent = 'Start swiping date locations'
  if (footerHelper) footerHelper.textContent = 'Create an account, choose the kinds of places you like, and build your first date deck.'
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
  card.setAttribute('aria-label', `${item.title}, ${item.category}`)

  const imageArea = document.createElement('div')
  imageArea.className = 'event-card__image'
  const image = document.createElement('img')
  image.src = item.image
  image.alt = `${item.title} location artwork`
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
  hint.textContent = 'Swipe to choose'
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
  alignLandingToDateLocations()
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
