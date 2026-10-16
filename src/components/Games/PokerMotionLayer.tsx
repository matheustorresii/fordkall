import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { POKER_PAYOUT_MOTION, pokerMotionEvents, type PokerMotion } from '../../games/pokerMotion'
import type { PokerState } from '../../games/poker'

type Flight = PokerMotion & { key: number }
export const PokerMotionLayer = ({ state, locations }: { state: PokerState; locations: Record<string, [number, number]> }) => {
  const previous = useRef<PokerState | null>(null)
  const sequence = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [flights, setFlights] = useState<Flight[]>([])
  useLayoutEffect(() => {
    const cues = pokerMotionEvents(previous.current, state)
    previous.current = state
    if (!cues.length || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    clearTimeout(timer.current)
    setFlights(cues.slice(0, 30).map((cue) => ({ ...cue, key: sequence.current++ })))
    timer.current = setTimeout(() => setFlights([]), Math.max(...cues.map((cue) => cue.delay + (cue.kind === 'pay' ? POKER_PAYOUT_MOTION.travel : 850))) + 120)
  }, [state])
  useEffect(() => () => clearTimeout(timer.current), [])
  const location = (id: string): [number, number] => {
    if (id === 'pot') return [50, 40]
    if (id === 'deck') return [46, 44]
    if (id === 'muck') return [57, 47]
    if (id.startsWith('bet:')) {
      const [x, y] = locations[id.slice(4)] ?? [50, 50]
      return [x * .68 + 16, y * .68 + 16]
    }
    return locations[id] ?? [50, 50]
  }
  return <div className="poker-motion" aria-hidden="true">
    {flights.map((flight) => {
      const from = location(flight.from), to = location(flight.to)
      return <span className={`poker-flight poker-flight--${flight.kind}`} key={flight.key} data-poker-payment={flight.kind === 'pay' ? flight.to : undefined} data-chip-amount={flight.amount} style={{
        '--from-x': `${from[0]}%`, '--from-y': `${from[1]}%`, '--to-x': `${to[0]}%`, '--to-y': `${to[1]}%`, animationDelay: `${flight.delay}ms`,
        '--mid-x': `${(from[0] + to[0]) / 2}%`, '--mid-y': `${Math.min(from[1], to[1]) - 6}%`, '--pay-travel': `${POKER_PAYOUT_MOTION.travel}ms`,
      } as CSSProperties}>
        <span className="poker-flight__object">{flight.kind === 'deal' || flight.kind === 'fold' ? <><i /><i /></> : flight.kind === 'dealer' ? 'D' : <><i /><i /><i />{flight.kind === 'pay' && flight.amount && <b>+{flight.amount.toLocaleString('pt-BR')}</b>}</>}</span>
      </span>
    })}
  </div>
}
