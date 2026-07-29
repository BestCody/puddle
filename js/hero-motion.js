let cleanupHeroMotion = null

function mountHeroMotion() {
  cleanupHeroMotion?.()
  cleanupHeroMotion = null

  const stack = document.querySelector('.testimonial-stack')
  if (!stack) return

  const cards = Array.from(stack.querySelectorAll('.testimonial-card'))
  const counter = stack.querySelector('.testimonial-hint b')
  if (cards.length < 2) return

  const controller = new AbortController()
  const { signal } = controller
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let order = [...cards]
  let timer = 0
  let transitionTimer = 0
  let paused = reducedMotion.matches
  let transitioning = false

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

  const startTimer = () => {
    stopTimer()
    if (!paused && !reducedMotion.matches) timer = window.setInterval(() => advance(false), 4800)
  }

  const advance = manual => {
    if (transitioning || (!manual && paused) || reducedMotion.matches) return

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
    }, 650)
  }

  const setPaused = nextPaused => {
    paused = nextPaused || reducedMotion.matches
    if (paused) stopTimer()
    else startTimer()
  }

  stack.addEventListener('mouseenter', () => setPaused(true), { signal })
  stack.addEventListener('mouseleave', () => setPaused(false), { signal })
  stack.addEventListener('focusin', () => setPaused(true), { signal })
  stack.addEventListener('focusout', event => {
    if (!stack.contains(event.relatedTarget)) setPaused(false)
  }, { signal })
  stack.addEventListener('click', () => advance(true), { signal })
  stack.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight') {
      event.preventDefault()
      advance(true)
    }
  }, { signal })

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopTimer()
    else startTimer()
  }, { signal })

  reducedMotion.addEventListener?.('change', event => {
    setPaused(event.matches)
    render()
  }, { signal })

  render()
  startTimer()

  cleanupHeroMotion = () => {
    controller.abort()
    stopTimer()
    window.clearTimeout(transitionTimer)
  }
}
