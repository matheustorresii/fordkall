import { useCallback } from 'react'
import type { Room } from 'livekit-client'
import { useRoomGameProtocol, type RoomGameProtocolContext } from './useRoomGameProtocol'
import { defaultItoSettings, isItoOrderCorrect, itoCardCounts, itoNextProgress, itoRequiredVotes, readItoSettings, type ItoSettings } from '../games/itoRules'

// Multi-card rounds are not compatible with the old single-number protocol.
export const ITO_TOPIC = 'ford-kall.ito.v2'
const MAX_PLAYERS = 8
const MAX_CLUE_LENGTH = 80

export interface ItoPlayer { identity: string; name: string; cardCount: number }
export interface ItoCard { id: string; ownerIdentity: string; clue: string }
export interface ItoPrivateCard { cardId: string; value: number }
export interface ItoRoomState {
  gameId: string
  controllerIdentity: string
  revision: number
  phase: 'lobby' | 'clue' | 'order' | 'revealed'
  topic: string
  players: ItoPlayer[]
  cards: ItoCard[]
  order: string[]
  orderVersion: number
  revealVotes: string[]
  roundNumber: number
  extraCards: number
  settings: ItoSettings
  numbers?: Record<string, number>
  succeeded?: boolean
  campaignWon?: boolean
}

type ItoCommand =
  | { type: 'start'; settings: ItoSettings }
  | { type: 'clue'; gameId: string; cardId: string; clue: string }
  | { type: 'move'; gameId: string; cardId: string; offset: -1 | 1; orderVersion: number }
  | { type: 'vote'; gameId: string; approved: boolean; orderVersion: number }
  | { type: 'next-round'; gameId: string }
  | { type: 'reset' }

const topics = [
  'De quase nada urgente a precisa resolver agora', 'De péssima a ótima ideia para um domingo',
  'De pouco a muito constrangedor', 'De superpoder inútil a indispensável',
  'De nada assustador a dá medo de verdade', 'De lanche sem graça a lanche perfeito',
  'De tarefa fácil a missão impossível', 'De pouco a muito difícil de explicar',
  'De rolê tranquilo a história para contar', 'De pequeno incômodo a caos completo',
]
const cleanText = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : ''
const integer = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && Number(value) >= min && Number(value) <= max
const emptyPrivate: ItoPrivateCard[] = []
const emptyState = (controllerIdentity: string, revision = 0): ItoRoomState => ({
  gameId: '', controllerIdentity, revision, phase: 'lobby', topic: '', players: [], cards: [], order: [],
  orderVersion: 0, revealVotes: [], roundNumber: 0, extraCards: 0, settings: { ...defaultItoSettings },
})

const parseState = (value: unknown): ItoRoomState | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<ItoRoomState>
  const settings = readItoSettings(raw.settings)
  if (!settings || typeof raw.gameId !== 'string' || typeof raw.controllerIdentity !== 'string' ||
    !integer(raw.revision, 0, Number.MAX_SAFE_INTEGER) || !['lobby', 'clue', 'order', 'revealed'].includes(raw.phase ?? '') ||
    !integer(raw.roundNumber, 0, Number.MAX_SAFE_INTEGER) || !integer(raw.extraCards, 0, MAX_PLAYERS * 4) ||
    !integer(raw.orderVersion, 0, Number.MAX_SAFE_INTEGER) || !Array.isArray(raw.players) || raw.players.length > MAX_PLAYERS ||
    !Array.isArray(raw.cards) || raw.cards.length > 40 || !Array.isArray(raw.order) || !Array.isArray(raw.revealVotes)) return null
  const players = raw.players.flatMap((player) => {
    if (!player || typeof player !== 'object') return []
    const identity = cleanText(player.identity, 128), name = cleanText(player.name, 80)
    return identity && name && integer(player.cardCount, 1, settings.targetCards) ? [{ identity, name, cardCount: player.cardCount }] : []
  })
  const playerIds = new Set(players.map((player) => player.identity))
  if (players.length !== raw.players.length || playerIds.size !== players.length) return null
  const cards = raw.cards.flatMap((card) => {
    if (!card || typeof card !== 'object') return []
    const id = cleanText(card.id, 128), ownerIdentity = cleanText(card.ownerIdentity, 128)
    return id && playerIds.has(ownerIdentity) && typeof card.clue === 'string' ? [{ id, ownerIdentity, clue: cleanText(card.clue, MAX_CLUE_LENGTH) }] : []
  })
  const cardIds = new Set(cards.map((card) => card.id))
  const order = raw.order.map((id) => cleanText(id, 128))
  const revealVotes = raw.revealVotes.map((id) => cleanText(id, 128))
  const expectedCounts = itoCardCounts(players.length, raw.extraCards, settings.targetCards)
  if (cards.length !== raw.cards.length || cardIds.size !== cards.length ||
    order.length !== cards.length || new Set(order).size !== order.length || order.some((id) => !cardIds.has(id)) ||
    new Set(revealVotes).size !== revealVotes.length || revealVotes.some((id) => !playerIds.has(id)) ||
    players.some((player, index) => player.cardCount !== expectedCounts[index] || cards.filter((card) => card.ownerIdentity === player.identity).length !== player.cardCount)) return null
  if (raw.phase === 'lobby' ? raw.gameId || players.length || cards.length || raw.roundNumber || raw.extraCards :
    !raw.gameId || players.length < 2 || raw.roundNumber < 1 || raw.extraCards > players.length * (settings.targetCards - 1)) return null
  if ((raw.phase === 'order' || raw.phase === 'revealed') && cards.some((card) => !card.clue)) return null
  let numbers: Record<string, number> | undefined
  if (raw.phase === 'revealed') {
    if (!raw.numbers || typeof raw.numbers !== 'object') return null
    numbers = {}
    for (const [id, number] of Object.entries(raw.numbers)) {
      if (!cardIds.has(id) || !integer(number, 1, 100)) return null
      numbers[id] = number
    }
    if (Object.keys(numbers).length !== cards.length || new Set(Object.values(numbers)).size !== cards.length || typeof raw.succeeded !== 'boolean') return null
  } else if (raw.numbers !== undefined) return null
  return {
    gameId: cleanText(raw.gameId, 80), controllerIdentity: cleanText(raw.controllerIdentity, 128), revision: raw.revision,
    phase: raw.phase!, topic: cleanText(raw.topic, 120), players, cards, order, orderVersion: raw.orderVersion,
    revealVotes, roundNumber: raw.roundNumber, extraCards: raw.extraCards, settings,
    ...(numbers ? { numbers, succeeded: isItoOrderCorrect(order, numbers), campaignWon: isItoOrderCorrect(order, numbers) && raw.extraCards === players.length * (settings.targetCards - 1) } : {}),
  }
}

const parsePrivate = (value: unknown): ItoPrivateCard[] | null => {
  if (!Array.isArray(value) || value.length > 5) return null
  const cards = value.flatMap((card) => card && typeof card === 'object' && cleanText(card.cardId, 128) && integer(card.value, 1, 100) ? [{ cardId: cleanText(card.cardId, 128), value: card.value as number }] : [])
  return cards.length === value.length && new Set(cards.map((card) => card.cardId)).size === cards.length ? cards : null
}
const parseCommand = (value: unknown): ItoCommand | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.type === 'reset') return { type: 'reset' }
  if (raw.type === 'start') { const settings = readItoSettings(raw.settings); return settings ? { type: 'start', settings } : null }
  const gameId = cleanText(raw.gameId, 80)
  if (!gameId) return null
  if (raw.type === 'next-round') return { type: 'next-round', gameId }
  if (raw.type === 'vote' && typeof raw.approved === 'boolean' && integer(raw.orderVersion, 0, Number.MAX_SAFE_INTEGER)) return { type: 'vote', gameId, approved: raw.approved, orderVersion: raw.orderVersion }
  const cardId = cleanText(raw.cardId, 128)
  if (!cardId) return null
  if (raw.type === 'clue') { const clue = cleanText(raw.clue, MAX_CLUE_LENGTH); return clue ? { type: 'clue', gameId, cardId, clue } : null }
  return raw.type === 'move' && (raw.offset === -1 || raw.offset === 1) && integer(raw.orderVersion, 0, Number.MAX_SAFE_INTEGER) ? { type: 'move', gameId, cardId, offset: raw.offset, orderVersion: raw.orderVersion } : null
}
const shuffle = <T,>(values: T[]) => {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) { const other = Math.floor(Math.random() * (index + 1)); [result[index], result[other]] = [result[other]!, result[index]!] }
  return result
}
type Context = RoomGameProtocolContext<ItoRoomState, ItoPrivateCard[]>

export const useRoomIto = (room: Room) => {
  const handleCommand = useCallback((command: ItoCommand, senderIdentity: string, context: Context): string | null => {
    const current = context.state
    const player = current.players.find((person) => person.identity === senderIdentity)
    const connected = new Set([room.localParticipant.identity, ...room.remoteParticipants.keys()])
    if (!connected.has(senderIdentity)) return 'Você não está nesta sala.'
    const dealRound = (players: ItoPlayer[], extraCards: number, roundNumber: number, settings: ItoSettings) => {
      const counts = itoCardCounts(players.length, extraCards, settings.targetCards)
      const values = shuffle(Array.from({ length: 100 }, (_, index) => index + 1))
      const secrets: Record<string, ItoPrivateCard[]> = {}
      const cards: ItoCard[] = []
      players.forEach((person, index) => {
        secrets[person.identity] = []
        for (let count = 0; count < counts[index]!; count += 1) {
          const id = crypto.randomUUID()
          cards.push({ id, ownerIdentity: person.identity, clue: '' })
          secrets[person.identity]!.push({ cardId: id, value: values.pop()! })
        }
      })
      const gameId = crypto.randomUUID()
      const availableTopics = topics.filter((topic) => topic !== current.topic)
      context.commit(() => ({
        ...emptyState(room.localParticipant.identity), gameId, phase: 'clue', settings: { ...settings }, roundNumber, extraCards,
        topic: availableTopics[Math.floor(Math.random() * availableTopics.length)]!,
        players: players.map((person, index) => ({ ...person, cardCount: counts[index]! })), cards,
        order: shuffle(cards.map((card) => card.id)),
      }))
      context.replaceSecrets(gameId, secrets)
    }
    if (command.type === 'reset') { context.commit((latest) => emptyState(room.localParticipant.identity, latest.revision)); context.replaceSecrets('', {}); return null }
    if (command.type === 'start') {
      if (current.phase !== 'lobby' && !current.campaignWon) return 'Encerre a partida atual antes de mudar suas regras.'
      const members = [room.localParticipant, ...room.remoteParticipants.values()]
      if (members.length < 2 || members.length > MAX_PLAYERS) return 'ITO precisa de 2 a 8 pessoas.'
      dealRound(shuffle(members).map((person) => ({ identity: person.identity, name: cleanText(person.name || person.identity, 80), cardCount: 1 })), 0, 1, command.settings)
      return null
    }
    if (!player) return 'Você está assistindo, não participa desta partida.'
    if (command.gameId !== current.gameId) return 'A rodada mudou. Confira suas novas cartas.'
    if (command.type === 'next-round') {
      if (current.phase !== 'revealed' || current.campaignWon) return 'Esta rodada ainda não terminou ou a partida já foi vencida.'
      if (current.players.some((person) => !connected.has(person.identity))) return 'Uma pessoa da mesa saiu. Encerrem e iniciem uma nova partida com quem está na sala.'
      const extras = itoNextProgress(current.extraCards, Boolean(current.succeeded), current.settings.lossRule, current.players.length * (current.settings.targetCards - 1))
      dealRound(current.players, extras, current.roundNumber + 1, current.settings)
      return null
    }
    if (command.type === 'clue') {
      if (current.phase !== 'clue') return 'As dicas desta rodada já foram enviadas.'
      const card = current.cards.find((item) => item.id === command.cardId && item.ownerIdentity === senderIdentity)
      if (!card || !context.getSecrets()[senderIdentity]?.some((item) => item.cardId === card.id)) return 'Esta carta não está na sua mão.'
      const cards = current.cards.map((item) => item.id === card.id ? { ...item, clue: command.clue } : item)
      context.commit((latest) => ({ ...latest, cards, phase: cards.every((item) => item.clue) ? 'order' : 'clue', revealVotes: [] }))
      return null
    }
    if (current.phase !== 'order') return 'Esperem todas as dicas antes de organizar ou votar.'
    if (command.orderVersion !== current.orderVersion) return 'A ordem mudou. Confira a mesa antes de votar ou mover outra carta.'
    if (command.type === 'move') {
      const index = current.order.indexOf(command.cardId), other = index + command.offset
      if (index < 0 || other < 0 || other >= current.order.length) return null
      const order = [...current.order]; [order[index], order[other]] = [order[other]!, order[index]!]
      context.commit((latest) => ({ ...latest, order, orderVersion: latest.orderVersion + 1, revealVotes: [] }))
      return null
    }
    const votes = current.revealVotes.filter((identity) => identity !== senderIdentity)
    if (command.approved) votes.push(senderIdentity)
    if (votes.length < itoRequiredVotes(current.settings.revealRule, current.players.length)) {
      context.commit((latest) => ({ ...latest, revealVotes: votes })); return null
    }
    const numbers = Object.fromEntries(Object.values(context.getSecrets()).flat().map((card) => [card.cardId, card.value]))
    if (current.cards.some((card) => !integer(numbers[card.id], 1, 100))) return 'Faltam cartas privadas para revelar. Iniciem outra partida.'
    const succeeded = isItoOrderCorrect(current.order, numbers)
    context.commit((latest) => ({ ...latest, phase: 'revealed', revealVotes: votes, numbers, succeeded,
      campaignWon: succeeded && current.extraCards === current.players.length * (current.settings.targetCards - 1) }))
    return null
  }, [room])

  const protocol = useRoomGameProtocol<ItoRoomState, ItoCommand, ItoPrivateCard[]>({ room, topic: ITO_TOPIC, emptyState, parseState, parseCommand, parsePrivate, emptyPrivate, handleCommand })
  const { state, dispatch } = protocol
  return {
    state, localCards: protocol.localPrivate, error: protocol.error, clearError: protocol.clearError,
    isController: protocol.isController, participantCount: protocol.participantCount,
    isParticipating: state.players.some((player) => player.identity === room.localParticipant.identity),
    start: (settings: ItoSettings = defaultItoSettings) => dispatch({ type: 'start', settings }),
    submitClue: (cardId: string, clue: string) => dispatch({ type: 'clue', gameId: state.gameId, cardId, clue }),
    moveCard: (cardId: string, offset: -1 | 1) => dispatch({ type: 'move', gameId: state.gameId, cardId, offset, orderVersion: state.orderVersion }),
    voteReveal: (approved: boolean) => dispatch({ type: 'vote', gameId: state.gameId, approved, orderVersion: state.orderVersion }),
    nextRound: () => dispatch({ type: 'next-round', gameId: state.gameId }),
    reset: () => dispatch({ type: 'reset' }),
  }
}
