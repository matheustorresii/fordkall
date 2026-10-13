import { useCallback } from 'react'
import type { Room } from 'livekit-client'
import { useRoomGameProtocol, type RoomGameBaseState, type RoomGameProtocolContext } from './useRoomGameProtocol'

export type TrucoRank = '4' | '5' | '6' | '7' | 'Q' | 'J' | 'K' | 'A' | '2' | '3'
export type TrucoSuit = 'paus' | 'ouros' | 'copas' | 'espadas'
export type TrucoTeam = 0 | 1
export type TrucoStake = 2 | 4 | 6 | 10 | 12

export interface TrucoCard {
  id: string
  rank: TrucoRank
  suit: TrucoSuit
}

export interface TrucoPlayer {
  identity: string
  name: string
  seat: number
  team: TrucoTeam
}

export interface TrucoPlay {
  identity: string
  card: TrucoCard
}

export interface TrucoRaise {
  team: TrucoTeam
  identity: string
  targetStake: Exclude<TrucoStake, 2>
}

export interface TrucoRoomState extends RoomGameBaseState {
  phase: 'lobby' | 'playing' | 'hand-result' | 'finished'
  players: TrucoPlayer[]
  scores: [number, number]
  dealerSeat: number
  manoSeat: number
  currentSeat: number
  trickLeaderSeat: number
  trickIndex: number
  trickPlays: TrucoPlay[]
  lastTrick: TrucoPlay[]
  trickWinners: Array<TrucoTeam | null>
  stake: TrucoStake
  lastRaiseTeam: TrucoTeam | null
  pendingRaise: TrucoRaise | null
  handWinner: TrucoTeam | null
  lastHandMessage: string
}

type TrucoCommand =
  | { type: 'start' }
  | { type: 'play'; cardId: string }
  | { type: 'call-truco' }
  | { type: 'accept-raise' }
  | { type: 'refuse-raise' }
  | { type: 'next-hand' }
  | { type: 'reset' }

const topic = 'ford-kall.truco-mineiro.v1'
const ranks: TrucoRank[] = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3']
const suits: TrucoSuit[] = ['paus', 'ouros', 'copas', 'espadas']
const normalPower: Record<TrucoRank, number> = { '4': 1, '5': 2, '6': 3, '7': 4, Q: 5, J: 6, K: 7, A: 8, '2': 9, '3': 10 }
// Manilha fixa mineira, da mais fraca para a mais forte.
const fixedManilhaPower: Record<string, number> = {
  '7-ouros': 11,
  'A-espadas': 12,
  '7-copas': 13,
  '4-paus': 14,
}
const emptyHand: TrucoCard[] = []

const cleanText = (value: unknown, max = 80) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max)
  : ''

const cardFrom = (value: unknown): TrucoCard | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<TrucoCard>
  if (!ranks.includes(raw.rank as TrucoRank) || !suits.includes(raw.suit as TrucoSuit)) return null
  const id = `${raw.rank}-${raw.suit}`
  return raw.id === id ? { id, rank: raw.rank as TrucoRank, suit: raw.suit as TrucoSuit } : null
}

const parseHand = (value: unknown): TrucoCard[] | null => {
  if (!Array.isArray(value) || value.length > 3) return null
  const cards = value.flatMap((item) => { const card = cardFrom(item); return card ? [card] : [] })
  return cards.length === value.length && new Set(cards.map((card) => card.id)).size === cards.length ? cards : null
}

const emptyState = (controllerIdentity: string, revision = 0): TrucoRoomState => ({
  gameId: '', controllerIdentity, revision, phase: 'lobby', players: [], scores: [0, 0],
  dealerSeat: 0, manoSeat: 1, currentSeat: 1, trickLeaderSeat: 1, trickIndex: 0,
  trickPlays: [], lastTrick: [], trickWinners: [], stake: 2,
  lastRaiseTeam: null, pendingRaise: null, handWinner: null, lastHandMessage: '',
})

const parseState = (value: unknown): TrucoRoomState | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<TrucoRoomState>
  if (
    typeof raw.gameId !== 'string' || typeof raw.controllerIdentity !== 'string' || !Number.isInteger(raw.revision) ||
    !['lobby', 'playing', 'hand-result', 'finished'].includes(raw.phase ?? '') || !Array.isArray(raw.players) ||
    raw.players.length > 4 || !Array.isArray(raw.scores) || raw.scores.length !== 2 ||
    !raw.scores.every((score) => Number.isInteger(score) && score! >= 0 && score! <= 12) ||
    !Array.isArray(raw.trickPlays) || raw.trickPlays.length > 4 || !Array.isArray(raw.lastTrick) || raw.lastTrick.length > 4 ||
    !Array.isArray(raw.trickWinners) || raw.trickWinners.length > 3 ||
    !Number.isInteger(raw.dealerSeat) || raw.dealerSeat! < 0 || raw.dealerSeat! > 3 ||
    !Number.isInteger(raw.manoSeat) || raw.manoSeat! < 0 || raw.manoSeat! > 3 ||
    !Number.isInteger(raw.currentSeat) || raw.currentSeat! < 0 || raw.currentSeat! > 3 ||
    !Number.isInteger(raw.trickLeaderSeat) || raw.trickLeaderSeat! < 0 || raw.trickLeaderSeat! > 3 ||
    !Number.isInteger(raw.trickIndex) || raw.trickIndex! < 0 || raw.trickIndex! > 3 ||
    ![2, 4, 6, 10, 12].includes(raw.stake as number) ||
    ![null, 0, 1].includes(raw.lastRaiseTeam as TrucoTeam | null) || ![null, 0, 1].includes(raw.handWinner as TrucoTeam | null)
  ) return null

  const players = raw.players.flatMap((player) => {
    if (!player || typeof player !== 'object') return []
    const candidate = player as Partial<TrucoPlayer>
    const identity = cleanText(candidate.identity, 128)
    const name = cleanText(candidate.name)
    if (!identity || !name || !Number.isInteger(candidate.seat) || candidate.seat! < 0 || candidate.seat! > 3 ||
      (candidate.team !== 0 && candidate.team !== 1) || candidate.team !== (candidate.seat! % 2 === 0 ? 0 : 1)) return []
    return [{ identity, name, seat: candidate.seat!, team: candidate.team }]
  })
  if (players.length !== raw.players.length || new Set(players.map((player) => player.identity)).size !== players.length ||
    new Set(players.map((player) => player.seat)).size !== players.length) return null

  const parsePlays = (plays: unknown[]) => plays.flatMap((play) => {
    if (!play || typeof play !== 'object') return []
    const candidate = play as Partial<TrucoPlay>
    const card = cardFrom(candidate.card)
    const player = players.find((item) => item.identity === candidate.identity)
    return card && player ? [{ identity: player.identity, card }] : []
  })
  const trickPlays = parsePlays(raw.trickPlays)
  const lastTrick = parsePlays(raw.lastTrick)
  if (trickPlays.length !== raw.trickPlays.length || lastTrick.length !== raw.lastTrick.length ||
    raw.trickWinners.some((winner) => winner !== null && winner !== 0 && winner !== 1)) return null

  let pendingRaise: TrucoRaise | null = null
  if (raw.pendingRaise !== null && raw.pendingRaise !== undefined) {
    const candidate = raw.pendingRaise as Partial<TrucoRaise>
    const player = players.find((item) => item.identity === candidate.identity)
    if (!player || (candidate.team !== 0 && candidate.team !== 1) || player.team !== candidate.team ||
      ![4, 6, 10, 12].includes(candidate.targetStake as number)) return null
    pendingRaise = { team: candidate.team, identity: player.identity, targetStake: candidate.targetStake as TrucoRaise['targetStake'] }
  }

  return {
    gameId: cleanText(raw.gameId, 80), controllerIdentity: cleanText(raw.controllerIdentity, 128), revision: raw.revision as number,
    phase: raw.phase as TrucoRoomState['phase'], players, scores: [raw.scores[0] as number, raw.scores[1] as number],
    dealerSeat: raw.dealerSeat as number, manoSeat: raw.manoSeat as number, currentSeat: raw.currentSeat as number,
    trickLeaderSeat: raw.trickLeaderSeat as number, trickIndex: raw.trickIndex as number, trickPlays, lastTrick,
    trickWinners: raw.trickWinners as Array<TrucoTeam | null>, stake: raw.stake as TrucoStake,
    lastRaiseTeam: raw.lastRaiseTeam as TrucoTeam | null, pendingRaise,
    handWinner: raw.handWinner as TrucoTeam | null, lastHandMessage: cleanText(raw.lastHandMessage, 180),
  }
}

const parseCommand = (value: unknown): TrucoCommand | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.type === 'start') return { type: 'start' }
  if (raw.type === 'call-truco') return { type: 'call-truco' }
  if (raw.type === 'accept-raise') return { type: 'accept-raise' }
  if (raw.type === 'refuse-raise') return { type: 'refuse-raise' }
  if (raw.type === 'next-hand') return { type: 'next-hand' }
  if (raw.type === 'reset') return { type: 'reset' }
  if (raw.type === 'play') {
    const cardId = cleanText(raw.cardId, 24)
    return cardId ? { type: 'play', cardId } : null
  }
  return null
}

const shuffle = <T,>(items: T[]) => {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[swap]] = [result[swap]!, result[index]!]
  }
  return result
}

const makeDeck = () => shuffle(ranks.flatMap((rank) => suits.map((suit) => ({ id: `${rank}-${suit}`, rank, suit }))))
const teamOfSeat = (seat: number): TrucoTeam => seat % 2 === 0 ? 0 : 1
const cardPower = (card: TrucoCard) => fixedManilhaPower[card.id] ?? normalPower[card.rank]

const resolveTrick = (plays: TrucoPlay[], players: TrucoPlayer[]): { team: TrucoTeam; seat: number } | null => {
  const ranked = plays.map((play) => ({ play, power: cardPower(play.card) }))
  const highest = Math.max(...ranked.map((item) => item.power))
  const winners = ranked.filter((item) => item.power === highest)
  if (winners.length !== 1) return null
  const player = players.find((candidate) => candidate.identity === winners[0]!.play.identity)
  return player ? { team: player.team, seat: player.seat } : null
}

const resolveHandWinner = (winners: Array<TrucoTeam | null>, manoTeam: TrucoTeam): TrucoTeam | null => {
  if (winners.length < 2) return null
  const [first, second] = winners
  if (first === null && second === null) return winners.length >= 3 ? winners[2] ?? manoTeam : null
  if (first === null) return second ?? null
  if (second === null) return first
  if (first === second) return first
  if (winners.length < 3) return null
  return winners[2] ?? first
}

const nextStake = (stake: TrucoStake): TrucoRaise['targetStake'] | null =>
  stake === 2 ? 4 : stake === 4 ? 6 : stake === 6 ? 10 : stake === 10 ? 12 : null

const resolveMatch = (state: TrucoRoomState, winner: TrucoTeam, message: string): TrucoRoomState => {
  const scores: [number, number] = [...state.scores]
  scores[winner] = Math.min(12, scores[winner] + state.stake)
  return {
    ...state,
    phase: scores[winner] >= 12 ? 'finished' : 'hand-result',
    scores,
    handWinner: winner,
    pendingRaise: null,
    lastHandMessage: message,
  }
}

const dealHand = (state: TrucoRoomState, dealerSeat: number) => {
  const deck = makeDeck()
  const hands: Record<string, TrucoCard[]> = Object.fromEntries(state.players.map((player) => [player.identity, []]))
  for (let card = 0; card < 3; card += 1) {
    for (const player of state.players) hands[player.identity]!.push(deck.pop()!)
  }
  const manoSeat = (dealerSeat + 1) % 4
  return {
    hands,
    state: {
      ...state,
      phase: 'playing' as const,
      dealerSeat,
      manoSeat,
      currentSeat: manoSeat,
      trickLeaderSeat: manoSeat,
      trickIndex: 0,
      trickPlays: [],
      lastTrick: [],
      trickWinners: [],
      stake: 2 as const,
      lastRaiseTeam: null,
      pendingRaise: null,
      handWinner: null,
      lastHandMessage: '',
    },
  }
}

export const useRoomTruco = (room: Room) => {
  const handleCommand = useCallback((command: TrucoCommand, senderIdentity: string, context: RoomGameProtocolContext<TrucoRoomState, TrucoCard[]>) => {
    const current = context.state
    const player = current.players.find((candidate) => candidate.identity === senderIdentity)

    if (command.type === 'start') {
      if (current.gameId && current.phase !== 'finished') return 'Já há uma partida em andamento nesta sala.'
      const members = [room.localParticipant, ...room.remoteParticipants.values()]
        .sort((a, b) => a.identity.localeCompare(b.identity))
      if (members.length !== 4) return 'Truco Mineiro precisa de 4 pessoas: duas duplas alternadas.'
      const players: TrucoPlayer[] = members.map((member, seat) => ({
        identity: member.identity,
        name: cleanText(member.name || member.identity),
        seat,
        team: teamOfSeat(seat),
      }))
      const gameId = crypto.randomUUID()
      const base = { ...emptyState(room.localParticipant.identity), gameId, players }
      const hand = dealHand(base, 0)
      context.commit(() => hand.state)
      context.replaceSecrets(gameId, hand.hands)
      return null
    }

    if (command.type === 'reset') {
      context.commit((latest) => emptyState(room.localParticipant.identity, latest.revision))
      context.replaceSecrets('', {})
      return null
    }

    if (command.type === 'next-hand') {
      if (current.phase !== 'hand-result' || !current.players.length) return 'A mão atual ainda não terminou.'
      const dealerSeat = (current.dealerSeat + 1) % 4
      const next = dealHand(current, dealerSeat)
      context.commit(() => next.state)
      context.replaceSecrets(current.gameId, next.hands)
      return null
    }

    if (!player) return 'Você não está na partida atual.'
    if (current.phase !== 'playing') return 'Não há uma mão em andamento.'
    if (current.players[current.currentSeat]?.identity !== senderIdentity) return 'Ainda não é a sua vez.'

    if (command.type === 'call-truco') {
      if (current.pendingRaise) {
        if (current.pendingRaise.team === player.team) return 'A outra dupla precisa responder ao pedido.'
        const targetStake = nextStake(current.pendingRaise.targetStake as TrucoStake)
        if (!targetStake) return 'A mão já está no máximo de 12 pontos.'
        context.commit((latest) => ({
          ...latest,
          stake: latest.pendingRaise!.targetStake,
          pendingRaise: { team: player.team, identity: senderIdentity, targetStake },
          currentSeat: (latest.currentSeat + 1) % 4,
        }))
        return null
      }
      const targetStake = nextStake(current.stake)
      if (!targetStake) return 'A mão já está no máximo de 12 pontos.'
      if (current.lastRaiseTeam !== null && current.lastRaiseTeam === player.team) return 'A outra dupla precisa aumentar ou aceitar a aposta.'
      context.commit((latest) => ({
        ...latest,
        pendingRaise: { team: player.team, identity: senderIdentity, targetStake },
        currentSeat: (latest.currentSeat + 1) % 4,
      }))
      return null
    }

    if (command.type === 'accept-raise') {
      if (!current.pendingRaise || current.pendingRaise.team === player.team) return 'Não há um pedido da outra dupla para aceitar.'
      context.commit((latest) => ({
        ...latest,
        stake: latest.pendingRaise!.targetStake,
        lastRaiseTeam: latest.pendingRaise!.team,
        currentSeat: latest.players.find((candidate) => candidate.identity === latest.pendingRaise!.identity)?.seat ?? latest.currentSeat,
        pendingRaise: null,
      }))
      return null
    }

    if (command.type === 'refuse-raise') {
      if (!current.pendingRaise || current.pendingRaise.team === player.team) return 'Não há um pedido da outra dupla para recusar.'
      const winner = current.pendingRaise.team
      context.commit((latest) => resolveMatch(latest, winner, `A dupla ${winner + 1} ganhou ${latest.stake} pontos porque a aposta foi recusada.`))
      return null
    }

    if (command.type === 'play') {
      if (current.pendingRaise) return 'Respondam ao pedido de Truco antes de jogar uma carta.'
      const privateHands = context.getSecrets()
      const hand = privateHands[senderIdentity] ?? []
      const selected = hand.find((card) => card.id === command.cardId)
      if (!selected) return 'Essa carta não está na sua mão.'
      const updatedHand = hand.filter((card) => card.id !== command.cardId)
      context.setSecret(current.gameId, senderIdentity, updatedHand)
      const nextPlays = [...current.trickPlays, { identity: senderIdentity, card: selected }]
      if (nextPlays.length < 4) {
        context.commit((latest) => ({
          ...latest,
          trickPlays: nextPlays,
          currentSeat: (latest.currentSeat + 1) % 4,
        }))
        return null
      }

      const trickResult = resolveTrick(nextPlays, current.players)
      const trickWinners = [...current.trickWinners, trickResult?.team ?? null]
      const handWinner = resolveHandWinner(trickWinners, teamOfSeat(current.manoSeat))
      const nextLeader = trickResult?.seat ?? current.trickLeaderSeat
      const withResult: TrucoRoomState = {
        ...current,
        trickPlays: [],
        lastTrick: nextPlays,
        trickWinners,
        trickIndex: trickWinners.length,
        trickLeaderSeat: nextLeader,
        currentSeat: nextLeader,
      }
      if (handWinner !== null) {
        context.commit(() => resolveMatch(withResult, handWinner, `A dupla ${handWinner + 1} ganhou a mão por ${current.stake} pontos.`))
      } else {
        context.commit(() => withResult)
      }
      return null
    }
    return null
  }, [room])

  const game = useRoomGameProtocol<TrucoRoomState, TrucoCommand, TrucoCard[]>({
    room,
    topic,
    emptyState,
    parseState,
    parseCommand,
    parsePrivate: parseHand,
    emptyPrivate: emptyHand,
    handleCommand,
  })

  return {
    ...game,
    hand: game.localPrivate,
    start: useCallback(() => game.dispatch({ type: 'start' }), [game.dispatch]),
    play: useCallback((cardId: string) => game.dispatch({ type: 'play', cardId }), [game.dispatch]),
    callTruco: useCallback(() => game.dispatch({ type: 'call-truco' }), [game.dispatch]),
    acceptRaise: useCallback(() => game.dispatch({ type: 'accept-raise' }), [game.dispatch]),
    refuseRaise: useCallback(() => game.dispatch({ type: 'refuse-raise' }), [game.dispatch]),
    nextHand: useCallback(() => game.dispatch({ type: 'next-hand' }), [game.dispatch]),
    reset: useCallback(() => game.dispatch({ type: 'reset' }), [game.dispatch]),
  }
}
