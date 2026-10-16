import { useEffect, useRef, useState } from 'react'

/** Only runs while a number changes; no persistent render loop on a game table. */
export const AnimatedNumber = ({ value, duration = 480, delay = 0 }: { value: number; duration?: number; delay?: number }) => {
  const [shown, setShown] = useState(value)
  const current = useRef(value)
  useEffect(() => {
    if (document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      current.current = value
      setShown(value)
      return
    }
    const from = current.current
    let frame = 0
    let start = 0
    const tick = (time: number) => {
      const progress = Math.min(1, (time - start) / duration)
      const next = Math.round(from + (value - from) * (1 - (1 - progress) ** 3))
      current.current = next
      setShown(next)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    const begin = () => { start = performance.now(); frame = requestAnimationFrame(tick) }
    const timer = from !== value ? window.setTimeout(begin, delay) : undefined
    return () => { window.clearTimeout(timer); cancelAnimationFrame(frame) }
  }, [value, duration, delay])
  return <span aria-label={value.toLocaleString('pt-BR')}><span aria-hidden="true">{shown.toLocaleString('pt-BR')}</span></span>
}
