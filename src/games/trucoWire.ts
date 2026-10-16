import { TRUCO_RANKS, TRUCO_SUITS, trucoExpectedSeat, trucoNextStake } from './truco.ts'
import type { TrucoCard, TrucoMove, TrucoPlay, TrucoPlayer, TrucoRoomState, TrucoStake, TrucoTeam } from './truco'

const text = (v: unknown, max = 128): v is string => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v)
const integer = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && Number(v) >= min && Number(v) <= max
const team = (v: unknown): v is TrucoTeam | null => v === null || v === 0 || v === 1
export const parseTrucoCard = (v: unknown): TrucoCard | null => {
  if (!v || typeof v !== 'object') return null
  const raw = v as TrucoCard
  return TRUCO_RANKS.includes(raw.rank) && TRUCO_SUITS.includes(raw.suit) && raw.id === `${raw.rank}-${raw.suit}`
    ? { id: raw.id, rank: raw.rank, suit: raw.suit } : null
}
export const parseTrucoHand = (v: unknown): TrucoCard[] | null => {
  if (!Array.isArray(v) || v.length > 3) return null
  const cards = v.map(parseTrucoCard)
  return cards.every((c) => c !== null) && new Set(cards.map((c) => c!.id)).size === cards.length ? cards as TrucoCard[] : null
}
export const parseTrucoMove = (v: unknown): TrucoMove | null => {
  if (!v || typeof v !== 'object') return null
  const raw = v as Record<string, unknown>
  if (raw.type === 'call-truco' || raw.type === 'accept-raise' || raw.type === 'refuse-raise') return { type: raw.type }
  if (raw.type === 'play' && text(raw.cardId, 24) && raw.cardId) return { type: 'play', cardId: raw.cardId }
  return null
}
export const parseTrucoState = (v: unknown): TrucoRoomState | null => {
  if (!v || typeof v !== 'object') return null
  const raw = v as TrucoRoomState
  if (!text(raw.gameId) || !text(raw.matchId) || !text(raw.stepId) || !text(raw.controllerIdentity) ||
    !integer(raw.revision, 0, Number.MAX_SAFE_INTEGER) || !integer(raw.handNumber, 0, Number.MAX_SAFE_INTEGER) ||
    !['lobby', 'playing', 'hand-result', 'finished'].includes(raw.phase) || !Array.isArray(raw.players) ||
    !Array.isArray(raw.scores) || raw.scores.length !== 2 || !raw.scores.every((s) => integer(s, 0, 12)) ||
    ![raw.currentSeat, raw.dealerSeat, raw.manoSeat, raw.trickLeaderSeat].every((s) => integer(s, 0, 3)) ||
    !integer(raw.trickIndex, 0, 3) || ![2, 4, 6, 10, 12].includes(raw.stake) ||
    !team(raw.lastRaiseTeam) || !team(raw.handWinner) || !text(raw.lastHandMessage, 180) ||
    !Array.isArray(raw.trickWinners) || raw.trickWinners.length !== raw.trickIndex || !raw.trickWinners.every(team)) return null
  if (raw.players.length !== (raw.phase === 'lobby' ? 0 : 4)) return null
  const players: TrucoPlayer[] = []
  for (const p of raw.players) {
    if (!p || !text(p.identity) || !p.identity || !text(p.name, 80) || !p.name || !integer(p.seat, 0, 3) ||
      p.team !== p.seat % 2 || typeof p.connected !== 'boolean') return null
    players.push({ identity: p.identity, name: p.name, seat: p.seat, team: p.team, connected: p.connected })
  }
  if (new Set(players.map((p) => p.identity)).size !== players.length || new Set(players.map((p) => p.seat)).size !== players.length) return null
  const plays = (value: unknown): TrucoPlay[] | null => {
    if (!Array.isArray(value) || value.length > 4) return null
    const result: TrucoPlay[] = []
    for (const p of value) {
      const card = parseTrucoCard(p?.card)
      if (!card || !players.some((player) => player.identity === p.identity)) return null
      result.push({ identity: p.identity, card })
    }
    return new Set(result.map((p) => p.identity)).size === result.length && new Set(result.map((p) => p.card.id)).size === result.length ? result : null
  }
  const trickPlays = plays(raw.trickPlays), lastTrick = plays(raw.lastTrick)
  if (!trickPlays || !lastTrick || trickPlays.length > 3 || lastTrick.length !== (raw.trickIndex ? 4 : 0)) return null
  if (new Set([...lastTrick, ...trickPlays].map((p) => p.card.id)).size !== lastTrick.length + trickPlays.length) return null
  if (trickPlays.some((play, index) => players.find((p) => p.identity === play.identity)!.seat !== (raw.trickLeaderSeat + index) % 4)) return null
  if (raw.currentSeat !== trucoExpectedSeat(raw)) return null
  let pendingRaise: TrucoRoomState['pendingRaise'] = null
  if (raw.pendingRaise !== null) {
    const p = raw.pendingRaise, player = players.find((candidate) => candidate.identity === p?.identity), nextStake = trucoNextStake(raw.stake)
    if (!p || !player || player.team !== p.team || !nextStake || p.targetStake !== nextStake ||
      (raw.lastRaiseTeam !== null && raw.lastRaiseTeam === p.team) || raw.phase !== 'playing') return null
    pendingRaise = { identity: player.identity, team: p.team, targetStake: p.targetStake }
  }
  if (raw.phase !== 'lobby' && (!raw.gameId || !raw.matchId || !raw.stepId || raw.handNumber < 1 || raw.manoSeat !== (raw.dealerSeat + 1) % 4)) return null
  if (raw.phase === 'playing' && (raw.trickIndex >= 3 || raw.handWinner !== null || raw.scores.some((s) => s >= 12))) return null
  if (raw.phase === 'finished' && !raw.scores.some((s) => s >= 12)) return null
  return {
    gameId: raw.gameId, matchId: raw.matchId, stepId: raw.stepId, handNumber: raw.handNumber,
    controllerIdentity: raw.controllerIdentity, revision: raw.revision, phase: raw.phase, players,
    scores: [raw.scores[0]!, raw.scores[1]!], dealerSeat: raw.dealerSeat, manoSeat: raw.manoSeat,
    currentSeat: raw.currentSeat, trickLeaderSeat: raw.trickLeaderSeat, trickIndex: raw.trickIndex,
    trickPlays, lastTrick, trickWinners: [...raw.trickWinners], stake: raw.stake as TrucoStake,
    lastRaiseTeam: raw.lastRaiseTeam, pendingRaise, handWinner: raw.handWinner, lastHandMessage: raw.lastHandMessage,
  }
}
