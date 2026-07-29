(() => {
  let scrollFrame = 0
  let mountedHeader = null

  function mountGlassHeader() {
    const header = document.querySelector('.site-header')
    if (!header || header === mountedHeader) return
    mountedHeader = header

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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountGlassHeader, { once: true })
  } else {
    mountGlassHeader()
  }
})()
