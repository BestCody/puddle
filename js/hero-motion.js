let cleanupHeroMotion = null

function mountHeroMotion() {
  cleanupHeroMotion?.()
  cleanupHeroMotion = null

  const stack = document.querySelector('.testimonial-stack')
  const heroSide = stack?.closest('.hero__side')
  const toggle = heroSide?.querySelector('.motion-toggle')
  if (!stack || !heroSide) return

  const cards = Array.from(stack.querySelectorAll('.testimonial-card'))
  const counter = stack.querySelector('.testimonial-hint b')
  if (cards.length < 2) return

  const controller = new AbortController()
  const { signal } = controller
  let order = [...cards]
  let timer = 0
  let transitionTimer = 0
  let userPaused = false
  let pageHidden = document.hidden
  let transitioning = false

  heroSide.classList.add('hero-motion-enabled')

  const isPaused = () => userPaused || pageHidden

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
    if (!isPaused()) timer = window.setInterval(() => advance(false), 3000)
  }

  const syncPauseUI = () => {
    heroSide.classList.toggle('motion-paused', userPaused)
    if (!toggle) return
    toggle.setAttribute('aria-pressed', String(userPaused))
    toggle.innerHTML = userPaused
      ? '<span aria-hidden="true">▶</span> Play motion'
      : '<span aria-hidden="true">Ⅱ</span> Pause motion'
  }

  const advance = manual => {
    if (transitioning || (!manual && isPaused())) return

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

  toggle?.addEventListener('click', event => {
    event.stopPropagation()
    userPaused = !userPaused
    syncPauseUI()
    if (userPaused) stopTimer()
    else startTimer()
  }, { signal })

  stack.addEventListener('click', () => advance(true), { signal })
  stack.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight') {
      event.preventDefault()
      advance(true)
    }
  }, { signal })

  document.addEventListener('visibilitychange', () => {
    pageHidden = document.hidden
    if (pageHidden) stopTimer()
    else startTimer()
  }, { signal })

  syncPauseUI()
  render()
  startTimer()

  cleanupHeroMotion = () => {
    controller.abort()
    stopTimer()
    window.clearTimeout(transitionTimer)
    heroSide.classList.remove('hero-motion-enabled', 'motion-paused')
  }
}
