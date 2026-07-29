let cleanupHeroMotion = null

function mountHeroMotion() {
  cleanupHeroMotion?.()
  cleanupHeroMotion = null

  const stack = document.querySelector('.testimonial-stack')
  const heroSide = stack?.closest('.hero__side')
  if (!stack || !heroSide) return

  const cards = Array.from(stack.querySelectorAll('.testimonial-card'))
  const counter = stack.querySelector('.testimonial-hint b')
  if (cards.length < 2) return

  const controller = new AbortController()
  const { signal } = controller
  let order = [...cards]
  let timer = 0
  let transitionTimer = 0
  let pageHidden = document.hidden
  let transitioning = false

  heroSide.classList.add('hero-motion-enabled')

  const render = () => {
    order.forEach((card, position) => {
      card.dataset.position = String(position)
      card.setAttribute('aria-hidden', String(position !== 0))
    })

    if (counter) {
      const current = cards.indexOf(order[0]) + 1
      counter.textContent = `${String(current).padStart(2, '0')} / ${String(cards.length).padStart(2, '0')}`
    }
  }

  const stopTimer = () => {
    window.clearInterval(timer)
    timer = 0
  }

  const advance = () => {
    if (transitioning || pageHidden) return

    transitioning = true
    const outgoing = order[0]
    outgoing.classList.add('is-leaving')

    transitionTimer = window.setTimeout(() => {
      outgoing.classList.add('is-resetting')
      outgoing.classList.remove('is-leaving')
      order = [...order.slice(1), outgoing]
      render()

      requestAnimationFrame(() => requestAnimationFrame(() => {
        outgoing.classList.remove('is-resetting')
        transitioning = false
      }))
    }, 620)
  }

  const startTimer = () => {
    stopTimer()
    if (!pageHidden) timer = window.setInterval(advance, 3000)
  }

  document.addEventListener('visibilitychange', () => {
    pageHidden = document.hidden
    if (pageHidden) stopTimer()
    else startTimer()
  }, { signal })

  render()
  startTimer()

  cleanupHeroMotion = () => {
    controller.abort()
    stopTimer()
    window.clearTimeout(transitionTimer)
    heroSide.classList.remove('hero-motion-enabled')
  }
}
