const events = [
  { title: 'Moonlight Café', category: 'Coffee date', date: 'Open late', place: 'Queen West · 1.5 km', price: '$$', image: '/events/jazz.svg', description: 'Late-night espresso, vinyl, soft lights, and enough quiet to actually talk.', match: 'Easy conversation' },
  { title: 'Clay & Cabernet', category: 'Activity date', date: 'Saturday evenings', place: 'Dundas West · 3.1 km', price: '$$$', image: '/events/ceramics.svg', description: 'Make something slightly wonky together, with wine and alcohol-free drinks available.', match: 'Playful pick' },
  { title: 'Rooftop Cinema Club', category: 'Movie date', date: 'Sunset screenings', place: 'King West · 1.8 km', price: '$$', image: '/events/rooftop.svg', description: 'Cult classics, skyline views, popcorn, and blankets above the city.', match: 'Great second stop' },
  { title: 'Neon Garden Lounge', category: 'Evening date', date: 'Open until 1 AM', place: 'The Junction · 4.2 km', price: '$$$', image: '/events/neon-night.svg', description: 'A glowing indoor garden with small plates, mocktails, and tucked-away booths.', match: 'Romantic atmosphere' }
]

const modalCopy = {
  safety: [
    'Shared places first. Privacy controls always.',
    'Puddle centers social discovery on places and mutual actions. You control profile visibility and sharing, with blocking, reporting, account controls, and opt-in age-gated global connections.'
  ]
}

let currentIndex = 0
const history = []
const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

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
  const visible = [0, 1, 2].map((offset) => events[(currentIndex + offset) % events.length])
  const cards = visible.reverse().map((item, index) => cardElement(item, visible.length - 1 - index))
  deck.replaceChildren(...cards)
}

function completeSwipe(direction) {
  const card = $('#hero-deck .event-card:last-child')
  if (!card) return
  history.push(currentIndex)
  const x = direction === 'right' ? window.innerWidth : -window.innerWidth
  card.style.transform = `translateX(${x}px) rotate(${direction === 'right' ? 22 : -22}deg)`
  card.style.opacity = '0'
  window.setTimeout(() => {
    currentIndex = (currentIndex + 1) % events.length
    renderDeck()
  }, 260)
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

  const reset = () => {
    dragging = false
    card.style.transition = ''
    card.style.transform = ''
    currentX = 0
  }

  card.addEventListener('pointerdown', (event) => {
    dragging = true
    startX = event.clientX
    card.setPointerCapture?.(event.pointerId)
    card.style.transition = 'none'
  })
  card.addEventListener('pointermove', (event) => {
    if (!dragging) return
    currentX = event.clientX - startX
    card.style.transform = `translateX(${currentX}px) rotate(${currentX / 18}deg)`
  })
  card.addEventListener('pointerup', () => {
    if (!dragging) return
    if (Math.abs(currentX) > 85) completeSwipe(currentX > 0 ? 'right' : 'left')
    else reset()
  })
  card.addEventListener('pointercancel', reset)
  card.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    completeSwipe(event.key === 'ArrowRight' ? 'right' : 'left')
  })
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

function closeMobileMenu() {
  const header = $('#site-header')
  const button = $('.menu-button')
  header?.classList.remove('menu-open')
  button?.setAttribute('aria-expanded', 'false')
}

function initLanding() {
  renderDeck()

  $$('[data-swipe]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.swipe === 'undo') undo()
      else completeSwipe(button.dataset.swipe)
    })
  })

  $$('[data-open-modal]').forEach((button) => button.addEventListener('click', () => openModal(button.dataset.openModal)))
  $$('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal))
  $('#modal-backdrop')?.addEventListener('click', (event) => {
    if (event.target.id === 'modal-backdrop') closeModal()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal()
      closeMobileMenu()
    }
  })

  $('.menu-button')?.addEventListener('click', (event) => {
    const header = $('#site-header')
    const open = header?.classList.toggle('menu-open') || false
    event.currentTarget.setAttribute('aria-expanded', String(open))
  })
  $$('#site-header a').forEach((link) => link.addEventListener('click', closeMobileMenu))

  window.addEventListener('scroll', () => $('#site-header')?.classList.toggle('is-scrolled', window.scrollY > 20), { passive: true })
  $$('img').forEach((image, index) => {
    image.decoding = 'async'
    if (index > 6) image.loading = 'lazy'
  })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLanding, { once: true })
else initLanding()