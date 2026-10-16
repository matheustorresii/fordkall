import type { PokerState } from './poker'

export const POKER_PAYOUT_MOTION = { start: 250, winnerGap: 220, stackGap: 160, stacks: 3, travel: 1450, count: 450 } as const
export const pokerPayoutArrival = (winnerIndex: number) =>
  POKER_PAYOUT_MOTION.start + Math.max(0, winnerIndex) * POKER_PAYOUT_MOTION.winnerGap +
  (POKER_PAYOUT_MOTION.stacks - 1) * POKER_PAYOUT_MOTION.stackGap + POKER_PAYOUT_MOTION.travel
export const pokerPayoutDuration = (winners: number) => winners > 0 ? pokerPayoutArrival(winners - 1) + POKER_PAYOUT_MOTION.count + 150 : 0

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
  if (settled) Object.entries(after.result!.payouts).filter(([, amount]) => amount > 0).forEach(([identity, amount], index) => {
    if (amount > 0) for (let stack = 0; stack < POKER_PAYOUT_MOTION.stacks; stack++) events.push({
      kind: 'pay', from: 'pot', to: identity, amount: stack === 0 ? amount : undefined,
      delay: POKER_PAYOUT_MOTION.start + index * POKER_PAYOUT_MOTION.winnerGap + stack * POKER_PAYOUT_MOTION.stackGap,
    })
  })
  return events
}
