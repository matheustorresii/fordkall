import { useCallback } from 'react'
import type { Room } from 'livekit-client'
import { useRoomGameProtocol, type RoomGameBaseState, type RoomGameProtocolContext } from './useRoomGameProtocol'

export interface MindPlayer {
  identity: string
  name: string
  cardsRemaining: number
}

export interface MindMistake {
  identity: string
  playedCard: number
  lowerCards: Array<{ identity: string; value: number }>
}

export interface MindRoomState extends RoomGameBaseState {
  phase: 'lobby' | 'playing' | 'level-result' | 'won' | 'lost'
  players: MindPlayer[]
  level: number
  maxLevel: number
  lives: number
  maxLives: number
  shurikens: number
  played: number[]
  shurikenVotes: string[]
  lastMistake: MindMistake | null
  lastEvent: string
}

type MindCommand =
  | { type: 'start' }
  | { type: 'play'; card: number }
  | { type: 'vote-shuriken' }
  | { type: 'next-level' }
  | { type: 'reset' }

const topic = 'ford-kall.the-mind.v1'
const emptyHand: number[] = []
const cleanText = (value: unknown, max = 80) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max)
  : ''

const emptyState = (controllerIdentity: string, revision = 0): MindRoomState => ({
  gameId: '', controllerIdentity, revision, phase: 'lobby', players: [],
  level: 0, maxLevel: 0, lives: 0, maxLives: 0, shurikens: 0,
  played: [], shurikenVotes: [], lastMistake: null, lastEvent: '',
})

const parseHand = (value: unknown): number[] | null => Array.isArray(value) && value.length <= 12 &&
  value.every((card) => Number.isInteger(card) && card >= 1 && card <= 100) && new Set(value).size === value.length
  ? value as number[]
  : null

const parseState = (value: unknown): MindRoomState | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<MindRoomState>
  if (
    typeof raw.gameId !== 'string' || typeof raw.controllerIdentity !== 'string' || !Number.isInteger(raw.revision) ||
    !['lobby', 'playing', 'level-result', 'won', 'lost'].includes(raw.phase ?? '') || !Array.isArray(raw.players) ||
    raw.players.length > 4 || !Number.isInteger(raw.level) || raw.level! < 0 || raw.level! > 12 ||
    !Number.isInteger(raw.maxLevel) || raw.maxLevel! < 0 || raw.maxLevel! > 12 ||
    !Number.isInteger(raw.lives) || raw.lives! < 0 || raw.lives! > 4 ||
    !Number.isInteger(raw.maxLives) || raw.maxLives! < 0 || raw.maxLives! > 4 ||
    !Number.isInteger(raw.shurikens) || raw.shurikens! < 0 || raw.shurikens! > 4 ||
    !Array.isArray(raw.played) || raw.played.length > 100 || !raw.played.every((card) => Number.isInteger(card) && card >= 1 && card <= 100) ||
    !Array.isArray(raw.shurikenVotes) || raw.shurikenVotes.length > 4
  ) return null

  const players = raw.players.flatMap((player) => {
    if (!player || typeof player !== 'object') return []
    const candidate = player as Partial<MindPlayer>
    const identity = cleanText(candidate.identity, 128)
    const name = cleanText(candidate.name)
    if (!identity || !name || !Number.isInteger(candidate.cardsRemaining) || candidate.cardsRemaining! < 0 || candidate.cardsRemaining! > 12) return []
    return [{ identity, name, cardsRemaining: candidate.cardsRemaining! }]
  })
  if (players.length !== raw.players.length || new Set(players.map((player) => player.identity)).size !== players.length) return null
  const shurikenVotes = raw.shurikenVotes.flatMap((identity) => typeof identity === 'string' ? [cleanText(identity, 128)] : [])
  if (shurikenVotes.length !== raw.shurikenVotes.length || shurikenVotes.some((identity) => !players.some((player) => player.identity === identity)) ||
    new Set(shurikenVotes).size !== shurikenVotes.length) return null

  let lastMistake: MindMistake | null = null
  if (raw.lastMistake !== null && raw.lastMistake !== undefined) {
    const candidate = raw.lastMistake as Partial<MindMistake>
    const player = players.find((item) => item.identity === candidate.identity)
    if (!player || !Number.isInteger(candidate.playedCard) || candidate.playedCard! < 1 || candidate.playedCard! > 100 ||
      !Array.isArray(candidate.lowerCards) || candidate.lowerCards.length > 12) return null
    const lowerCards = candidate.lowerCards.flatMap((card) => {
      if (!card || typeof card !== 'object') return []
      const identity = cleanText((card as { identity?: unknown }).identity, 128)
      const value = (card as { value?: unknown }).value
      return players.some((item) => item.identity === identity) && Number.isInteger(value) && (value as number) >= 1 && (value as number) < candidate.playedCard!
        ? [{ identity, value: value as number }]
        : []
    })
    if (lowerCards.length !== candidate.lowerCards.length) return null
    lastMistake = { identity: player.identity, playedCard: candidate.playedCard!, lowerCards }
  }

  return {
    gameId: cleanText(raw.gameId, 80), controllerIdentity: cleanText(raw.controllerIdentity, 128),
    revision: raw.revision as number, phase: raw.phase as MindRoomState['phase'], players,
    level: raw.level as number, maxLevel: raw.maxLevel as number, lives: raw.lives as number,
    maxLives: raw.maxLives as number, shurikens: raw.shurikens as number,
    played: raw.played as number[], shurikenVotes, lastMistake,
    lastEvent: cleanText(raw.lastEvent, 180),
  }
}

const parseCommand = (value: unknown): MindCommand | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.type === 'start') return { type: 'start' }
  if (raw.type === 'vote-shuriken') return { type: 'vote-shuriken' }
  if (raw.type === 'next-level') return { type: 'next-level' }
  if (raw.type === 'reset') return { type: 'reset' }
  if (raw.type === 'play' && Number.isInteger(raw.card) && (raw.card as number) >= 1 && (raw.card as number) <= 100) {
    return { type: 'play', card: raw.card as number }
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

const maxLevelFor = (players: number) => players === 2 ? 12 : players === 3 ? 10 : 8
const shurikenRewardLevels = new Set([2, 5, 8, 11])
const lifeRewardLevels = new Set([3, 6, 9, 12])

const dealLevel = (state: MindRoomState, level: number) => {
  const deck = shuffle(Array.from({ length: 100 }, (_, index) => index + 1))
  const hands: Record<string, number[]> = Object.fromEntries(state.players.map((player) => [player.identity, []]))
  for (let card = 0; card < level; card += 1) {
    for (const player of state.players) hands[player.identity]!.push(deck.pop()!)
  }
  for (const hand of Object.values(hands)) hand.sort((a, b) => a - b)
  return {
    hands,
    state: {
      ...state,
      phase: 'playing' as const,
      level,
      players: state.players.map((player) => ({ ...player, cardsRemaining: level })),
      played: [],
      shurikenVotes: [],
      lastMistake: null,
      lastEvent: '',
    },
  }
}

const updateCardCounts = (players: MindPlayer[], secrets: Record<string, number[]>) =>
  players.map((player) => ({ ...player, cardsRemaining: (secrets[player.identity] ?? []).length }))

const finishLevelIfReady = (state: MindRoomState, secrets: Record<string, number[]>): MindRoomState => {
  if (state.phase === 'playing' && state.players.every((player) => (secrets[player.identity] ?? []).length === 0)) {
    return { ...state, phase: state.level >= state.maxLevel ? 'won' : 'level-result', lastEvent: `Nível ${state.level} concluído.` }
  }
  return state
}

export const useRoomMind = (room: Room) => {
  const handleCommand = useCallback((command: MindCommand, senderIdentity: string, context: RoomGameProtocolContext<MindRoomState, number[]>) => {
    const current = context.state
    const player = current.players.find((candidate) => candidate.identity === senderIdentity)

    if (command.type === 'start') {
      if (current.gameId && !['won', 'lost'].includes(current.phase)) return 'Já há uma partida em andamento nesta sala.'
      const members = [room.localParticipant, ...room.remoteParticipants.values()]
        .sort((a, b) => a.identity.localeCompare(b.identity))
      if (members.length < 2 || members.length > 4) return 'The Mind aceita de 2 a 4 pessoas.'
      const maxLevel = maxLevelFor(members.length)
      const base: MindRoomState = {
        ...emptyState(room.localParticipant.identity),
        gameId: crypto.randomUUID(),
        phase: 'playing',
        players: members.map((member) => ({ identity: member.identity, name: cleanText(member.name || member.identity), cardsRemaining: 1 })),
        level: 1,
        maxLevel,
        lives: members.length,
        maxLives: members.length,
        shurikens: 1,
      }
      const firstLevel = dealLevel(base, 1)
      context.commit(() => firstLevel.state)
      context.replaceSecrets(base.gameId, firstLevel.hands)
      return null
    }

    if (command.type === 'reset') {
      context.commit((latest) => emptyState(room.localParticipant.identity, latest.revision))
      context.replaceSecrets('', {})
      return null
    }

    if (command.type === 'next-level') {
      if (current.phase !== 'level-result') return 'Concluam o nível atual antes de continuar.'
      const completedLevel = current.level
      const base: MindRoomState = {
        ...current,
        shurikens: Math.min(4, current.shurikens + (shurikenRewardLevels.has(completedLevel) ? 1 : 0)),
        lives: Math.min(current.maxLives, current.lives + (lifeRewardLevels.has(completedLevel) ? 1 : 0)),
      }
      const next = dealLevel(base, completedLevel + 1)
      context.commit(() => next.state)
      context.replaceSecrets(current.gameId, next.hands)
      return null
    }

    if (!player) return 'Você não participa desta partida.'
    if (current.phase !== 'playing') return 'Não há um nível em andamento.'

    if (command.type === 'play') {
      const secrets = context.getSecrets()
      const hand = secrets[senderIdentity] ?? []
      if (!hand.includes(command.card)) return 'Essa carta não está na sua mão.'
      const lowerCards = current.players.flatMap((candidate) => (secrets[candidate.identity] ?? [])
        .filter((card) => card < command.card)
        .map((value) => ({ identity: candidate.identity, value })))
      const nextSecrets = { ...secrets, [senderIdentity]: hand.filter((card) => card !== command.card) }
      if (lowerCards.length) {
        for (const lower of lowerCards) {
          nextSecrets[lower.identity] = (nextSecrets[lower.identity] ?? []).filter((card) => card !== lower.value)
        }
        for (const [identity, secret] of Object.entries(nextSecrets)) context.setSecret(current.gameId, identity, secret)
        const lives = Math.max(0, current.lives - 1)
        const revealed = [...lowerCards.map((card) => card.value), command.card].sort((a, b) => a - b)
        const mistake = {
          identity: senderIdentity,
          playedCard: command.card,
          lowerCards: lowerCards.sort((a, b) => a.value - b.value),
        }
        const withMistake: MindRoomState = {
          ...current,
          phase: lives === 0 ? 'lost' : 'playing',
          lives,
          played: [...current.played, ...revealed],
          players: updateCardCounts(current.players, nextSecrets),
          shurikenVotes: [],
          lastMistake: mistake,
          lastEvent: `${current.players.find((candidate) => candidate.identity === senderIdentity)?.name ?? 'Alguém'} jogou ${command.card} antes de ${lowerCards.map((card) => card.value).join(', ')}. Perderam uma vida.`,
        }
        context.commit(() => finishLevelIfReady(withMistake, nextSecrets))
        return null
      }

      nextSecrets[senderIdentity] = nextSecrets[senderIdentity]!.filter((card) => card !== command.card)
      for (const [identity, secret] of Object.entries(nextSecrets)) context.setSecret(current.gameId, identity, secret)
      const nextState: MindRoomState = {
        ...current,
        played: [...current.played, command.card],
        players: updateCardCounts(current.players, nextSecrets),
        shurikenVotes: [],
        lastMistake: null,
        lastEvent: `${current.players.find((candidate) => candidate.identity === senderIdentity)?.name ?? 'Alguém'} jogou uma carta.`,
      }
      context.commit(() => finishLevelIfReady(nextState, nextSecrets))
      return null
    }

    if (command.type === 'vote-shuriken') {
      if (current.shurikens < 1) return 'Vocês não têm shurikens disponíveis.'
      if (current.shurikenVotes.includes(senderIdentity)) return 'Você já votou para usar o shuriken.'
      const votes = [...current.shurikenVotes, senderIdentity]
      if (votes.length < current.players.length) {
        context.commit((latest) => ({ ...latest, shurikenVotes: votes, lastEvent: `${votes.length} de ${current.players.length} votos para usar o shuriken.` }))
        return null
      }

      const secrets = context.getSecrets()
      const revealed: number[] = []
      const nextSecrets = { ...secrets }
      for (const candidate of current.players) {
        const hand = [...(secrets[candidate.identity] ?? [])]
        if (!hand.length) continue
        hand.sort((a, b) => a - b)
        const lowest = hand.shift()!
        revealed.push(lowest)
        nextSecrets[candidate.identity] = hand
      }
      for (const [identity, secret] of Object.entries(nextSecrets)) context.setSecret(current.gameId, identity, secret)
      const nextState: MindRoomState = {
        ...current,
        shurikens: Math.max(0, current.shurikens - 1),
        played: [...current.played, ...revealed.sort((a, b) => a - b)],
        players: updateCardCounts(current.players, nextSecrets),
        shurikenVotes: [],
        lastMistake: null,
        lastEvent: `Shuriken: ${revealed.sort((a, b) => a - b).join(', ')} foram reveladas.`,
      }
      context.commit(() => finishLevelIfReady(nextState, nextSecrets))
      return null
    }
    return null
  }, [room])

  const game = useRoomGameProtocol<MindRoomState, MindCommand, number[]>({
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
    play: useCallback((card: number) => game.dispatch({ type: 'play', card }), [game.dispatch]),
    voteShuriken: useCallback(() => game.dispatch({ type: 'vote-shuriken' }), [game.dispatch]),
    nextLevel: useCallback(() => game.dispatch({ type: 'next-level' }), [game.dispatch]),
    reset: useCallback(() => game.dispatch({ type: 'reset' }), [game.dispatch]),
  }
}
