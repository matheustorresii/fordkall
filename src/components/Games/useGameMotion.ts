import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** FLIP on game actions, not on voice/presence renders. Independent translate/scale preserve card fan rotations. */
export const useGameMotion = (revision: string, round: string) => {
  const root = useRef<HTMLElement>(null)
  const previous = useRef(new Map<string, { rect: DOMRect; revealed: boolean }>())
  const previousRound = useRef(round)
  const previousSize = useRef('')
  const running = useRef<Animation[]>([])
  useLayoutEffect(() => {
    running.current.forEach((animation) => animation.cancel())
    running.current = []
    if (previousRound.current !== round) previous.current.clear()
    previousRound.current = round
    const bounds = root.current?.getBoundingClientRect()
    const size = `${bounds?.width}:${bounds?.height}`
    if (previousSize.current !== size) previous.current.clear()
    previousSize.current = size
    const next = new Map<string, { rect: DOMRect; revealed: boolean }>()
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden
    const cards = root.current?.querySelectorAll<HTMLElement>('[data-game-card]') ?? []
    let entered = 0, flipped = 0
    for (const element of cards) {
      const id = element.dataset.gameCard!, rect = element.getBoundingClientRect(), old = previous.current.get(id)
      const revealed = element.dataset.gameRevealed === 'true'
      next.set(id, { rect, revealed })
      if (reduced || !rect.width || !rect.height || typeof element.animate !== 'function') continue
      let animation: Animation | undefined
      if (old && (Math.abs(old.rect.x - rect.x) > 2 || Math.abs(old.rect.y - rect.y) > 2)) {
        animation = element.animate([
          { translate: `${old.rect.x - rect.x}px ${old.rect.y - rect.y}px`, scale: `${old.rect.width / rect.width} ${old.rect.height / rect.height}`, zIndex: 20 },
          { translate: '0 0', scale: '1 1', zIndex: 20 },
        ], { duration: 500, easing: 'cubic-bezier(.2,.8,.2,1)' })
      } else if (old && revealed && !old.revealed) {
        animation = element.animate([
          { rotate: 'y 85deg', opacity: .25 }, { rotate: 'y 0deg', opacity: 1 },
        ], { duration: 430, delay: Math.min(flipped++ * 85, 800), fill: 'backwards', easing: 'ease-out' })
      } else if (!old) {
        animation = element.animate([
          { translate: '0 32px', scale: '.84', opacity: 0 }, { translate: '0 0', scale: '1', opacity: 1 },
        ], { duration: 380, delay: Math.min(entered++ * 65, 450), fill: 'backwards', easing: 'cubic-bezier(.2,.8,.2,1)' })
      }
      if (animation) running.current.push(animation)
    }
    previous.current = next
  }, [revision, round])
  useEffect(() => {
    const element = root.current
    // A user can pan a long hand/ITO rail between actions. Cache the new positions,
    // otherwise the next play would fly from the position before that scroll.
    const scrolled = () => {
      running.current.forEach((animation) => animation.cancel())
      running.current = []
      previous.current = new Map(Array.from(element?.querySelectorAll<HTMLElement>('[data-game-card]') ?? []).map((card) => [
        card.dataset.gameCard!, { rect: card.getBoundingClientRect(), revealed: card.dataset.gameRevealed === 'true' },
      ]))
    }
    element?.addEventListener('scroll', scrolled, { capture: true, passive: true })
    return () => {
      element?.removeEventListener('scroll', scrolled, true)
      running.current.forEach((animation) => animation.cancel())
    }
  }, [])
  return root
}

/** Let the last card reach the table before a round-result dialog covers it. */
export const useGameResultPause = (key: string, finished: boolean, duration = 850) => {
  const [ready, setReady] = useState('')
  useEffect(() => {
    if (!finished) { setReady(''); return }
    const timer = window.setTimeout(() => setReady(key), duration)
    return () => window.clearTimeout(timer)
  }, [key, finished, duration])
  return finished && ready === key
}
