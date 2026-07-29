(() => {
  let scrollFrame = 0

  function mountLiquidHeader() {
    const header = document.querySelector('.site-header')
    if (!header) return

    const syncScrolledState = () => {
      if (scrollFrame) return
      scrollFrame = requestAnimationFrame(() => {
        header.classList.toggle('is-scrolled', window.scrollY > 18)
        scrollFrame = 0
      })
    }

    header.classList.add('liquid-fallback')
    syncScrolledState()
    window.addEventListener('scroll', syncScrolledState, { passive: true })

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion || typeof window.liquidGL !== 'function') return

    try {
      window.liquidGL({
        snapshot: 'body',
        target: '.site-header',
        resolution: Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1 : 1.35),
        refraction: 0.012,
        bevelDepth: 0.065,
        bevelWidth: 0.14,
        frost: 1.1,
        shadow: true,
        specular: true,
        reveal: 'none',
        tilt: false,
        magnify: 1.01,
        on: {
          init() {
            header.classList.remove('liquid-fallback')
            header.classList.add('liquid-ready')
          },
        },
      })
    } catch (error) {
      console.warn('liquidGL unavailable; keeping the CSS glass fallback.', error)
    }
  }

  if (document.readyState === 'complete') mountLiquidHeader()
  else window.addEventListener('load', mountLiquidHeader, { once: true })
})()
