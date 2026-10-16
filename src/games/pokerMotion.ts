import type { PokerState } from './poker'

export type PokerMotion = {
  kind: 'bet' | 'collect' | 'pay' | 'fold' | 'deal' | 'dealer'
  from: string
  to: string
  amount?: number
  delay: number
}

/** Visual cues use public deltas only. They never inspect the deck or private cards. */
export const pokerMotionEvents = (before: PokerState | null, after: PokerState): PokerMotion[] => {
  const events: PokerMotion[] = []
  if (!after.gameId || after.phase === 'lobby') return events
  const newHand = before?.gameId !== after.gameId
  if (newHand) {
    if (after.phase !== 'playing') return events
    const players = after.players.filter((p) => p.inHand && !p.folded)
    for (let card = 0; card < 2; card++) players.forEach((p, index) => events.push({
      kind: 'deal', from: 'deck', to: p.identity, delay: (index + card * players.length) * 85,
    }))
    if (before?.matchId === after.matchId && before.dealer !== after.dealer)
      events.push({ kind: 'dealer', from: before.dealer, to: after.dealer, delay: 0 })
    return events
  }
  if (!before) return events
  const settled = !before.result && after.result
  const collecting = before.street !== after.street || Boolean(settled)
  for (const player of after.players) {
    const previous = before.players.find((p) => p.identity === player.identity)
    if (!previous) continue
    if (player.folded && !previous.folded && previous.inHand)
      events.push({ kind: 'fold', from: player.identity, to: 'muck', delay: 0 })
    const paid = player.committed - previous.committed
    if (paid > 0) events.push({ kind: 'bet', from: player.identity, to: collecting ? 'pot' : `bet:${player.identity}`, amount: paid, delay: 0 })
    if (collecting && previous.bet > 0)
      events.push({ kind: 'collect', from: `bet:${player.identity}`, to: 'pot', amount: previous.bet, delay: 80 })
  }
  if (settled) Object.entries(after.result!.payouts).forEach(([identity, amount], index) => {
    if (amount > 0) events.push({ kind: 'pay', from: 'pot', to: identity, amount, delay: 460 + index * 160 })
  })
  return events
}
