(() => {
  let scrollFrame = 0
  let mountedHeader = null

  function loadScript(src, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-dynamic-src="${src}"]`)
      if (existing?.dataset.loaded === 'true') {
        resolve()
        return
      }

      const script = existing || document.createElement('script')
      const timeout = window.setTimeout(() => reject(new Error(`Timed out loading ${src}`)), timeoutMs)

      const finish = callback => {
        window.clearTimeout(timeout)
        callback()
      }

      script.addEventListener('load', () => {
        script.dataset.loaded = 'true'
        finish(resolve)
      }, { once: true })
      script.addEventListener('error', () => finish(() => reject(new Error(`Failed to load ${src}`))), { once: true })

      if (!existing) {
        script.src = src
        script.async = true
        script.crossOrigin = 'anonymous'
        script.dataset.dynamicSrc = src
        document.head.appendChild(script)
      }
    })
  }

  function initializeLiquidGL(header) {
    if (typeof window.liquidGL !== 'function') throw new Error('liquidGL did not initialize')

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
  }

  async function enhanceWithLiquidGL(header) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    try {
      await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js')
      await loadScript('https://cdn.jsdelivr.net/gh/naughtyduk/liquidGL@2cef983b7fe593d3e0878dc78e5b79b47038a953/scripts/liquidGL.js')
      initializeLiquidGL(header)
    } catch (error) {
      console.warn('liquidGL unavailable; keeping the CSS glass fallback.', error)
    }
  }

  function mountLiquidHeader() {
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

    const beginEnhancement = () => enhanceWithLiquidGL(header)
    if ('requestIdleCallback' in window) window.requestIdleCallback(beginEnhancement, { timeout: 1200 })
    else window.setTimeout(beginEnhancement, 250)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountLiquidHeader, { once: true })
  } else {
    mountLiquidHeader()
  }
})()