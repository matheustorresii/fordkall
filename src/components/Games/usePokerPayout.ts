import { useLayoutEffect, useRef, useState } from 'react'
import type { PokerState } from '../../games/poker'
import { pokerPayoutDuration } from '../../games/pokerMotion'

/** Presentation only: never delays the authoritative result or replays an old payment on remount. */
export const usePokerPayout = (state: PokerState) => {
  const previous = useRef<{ gameId: string; result: boolean } | null>(null)
  const [payingHand, setPayingHand] = useState('')
  const hasResult = Boolean(state.result)
  useLayoutEffect(() => {
    const before = previous.current
    previous.current = { gameId: state.gameId, result: hasResult }
    const winners = Object.values(state.result?.payouts ?? {}).filter((amount) => amount > 0).length
    if (!hasResult || !winners || before?.gameId !== state.gameId || before.result ||
        document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPayingHand('')
      return
    }
    setPayingHand(state.gameId)
    const timer = window.setTimeout(() => setPayingHand(''), pokerPayoutDuration(winners))
    return () => window.clearTimeout(timer)
    // Membership snapshots must not restart the same payment.
  }, [state.gameId, hasResult])
  return hasResult && payingHand === state.gameId
}
