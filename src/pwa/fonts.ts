// Decorative profile fonts must not block boot when Google Fonts is slow or unreachable.
// System font fallbacks remain available offline; this preserves the existing font catalog.
export function loadDisplayFonts() {
  if (document.querySelector('link[data-fordkall-fonts]')) return
  const load = () => {
    if (document.querySelector('link[data-fordkall-fonts]')) return
    const link = document.createElement('link')
    link.dataset.fordkallFonts = 'true'
    link.rel = 'stylesheet'
    link.media = 'print'
    link.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,500;0,600;0,700;1,700&family=Bungee&family=IBM+Plex+Mono:wght@400;500;600&family=Playfair+Display:ital,wght@0,700;1,700&display=swap'
    link.addEventListener('load', () => { link.media = 'all' }, { once: true })
    document.head.appendChild(link)
  }
  if (navigator.onLine) load()
  else window.addEventListener('online', load, { once: true })
}
