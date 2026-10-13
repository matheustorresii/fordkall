import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomEvent, type RemoteParticipant, type Room } from 'livekit-client'

const TOPIC = 'ford-kall.exploding-kiwi.v1'
const MAX_PLAYERS = 5
const REACTION_MS = 4_000
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export type KiwiExpansion = 'imploding' | 'streaking' | 'barking' | 'zombie'
export type KiwiCardType =
  | 'kiwi-burst' | 'leaf-helmet' | 'attack' | 'favor' | 'nope' | 'shuffle' | 'skip' | 'see-future-3' | 'alter-future-3'
  | 'kiwi-cat-a' | 'kiwi-cat-b' | 'kiwi-cat-c' | 'kiwi-cat-d' | 'kiwi-cat-e'
  | 'imploding' | 'feral-kiwi' | 'targeted-attack' | 'reverse' | 'draw-bottom'
  | 'streaking' | 'catomic-bomb' | 'mark' | 'curse' | 'super-skip' | 'see-future-5' | 'alter-future-5' | 'swap-top-bottom' | 'garbage-collection'
  | 'barking' | 'alter-future-now' | 'tower-of-power' | 'take-that' | 'potluck' | 'bury' | 'personal-attack' | 'share-future'
  | 'zombie' | 'attack-of-dead' | 'grave-robber' | 'feed-dead' | 'dig-deeper' | 'clone' | 'clairvoyance' | 'shuffle-now'
export type KiwiPhase = 'lobby' | 'playing' | 'finished'

export interface KiwiCard { id: string; type: KiwiCardType; faceUp?: boolean; marked?: boolean; playedByIdentity?: string }
export interface KiwiPlayer {
  identity: string
  name: string
  alive: boolean
  handCount: number
  blind?: boolean
  tower?: boolean
  explosionCard?: KiwiCard
  markedCardType?: KiwiCardType
  takeThatCard?: KiwiCard
  takeThatByIdentity?: string
  stashCount?: number
}
export interface KiwiPendingAction {
  id: string
  actorIdentity: string
  cardType: KiwiCardType | 'combo-pair' | 'combo-triple' | 'combo-five'
  cardIds: string[]
  targetIdentity: string
  secondaryTargetIdentity: string
  namedCardType?: KiwiCardType
  nopeCount: number
  resolvesAt: number
}
export interface KiwiPrompt {
  kind: 'favor' | 'insert' | 'reorder' | 'bury' | 'give' | 'reveal' | 'barking' | 'tower'
  actorIdentity: string
  targetIdentity: string
  queue: string[]
  label: string
  count: number
  endTurnAfter?: boolean
}
export interface KiwiRoomState {
  gameId: string
  controllerIdentity: string
  revision: number
  phase: KiwiPhase
  expansions: KiwiExpansion[]
  excludedCards: KiwiCardType[]
  players: KiwiPlayer[]
  currentPlayerIdentity: string
  turnsRemaining: number
  direction: 1 | -1
  deckCount: number
  discard: KiwiCard[]
  pendingDefenseIdentity: string
  pendingDefenseTurnIdentity: string
  pendingDefenseType: 'kiwi-burst' | 'imploding' | 'barking' | ''
  pendingAction: KiwiPendingAction | null
  prompt: KiwiPrompt | null
  pendingFavor: { fromIdentity: string; toIdentity: string } | null
  barkingOwnerIdentity: string
  winnerIdentity: string
  lastAction: string
}

type KiwiCommand =
  | { type: 'start'; expansions: KiwiExpansion[]; excludedCards: KiwiCardType[] }
  | { type: 'play'; cardIds: string[]; targetIdentity: string; namedCardType?: KiwiCardType }
  | { type: 'draw' }
  | { type: 'defuse'; cardId: string; position: number; reviveIdentity?: string; secondPosition?: number }
  | { type: 'favor'; cardId: string }
  | { type: 'nope'; cardId: string }
  | { type: 'choose'; cardId?: string; cardIds?: string[]; position?: number; targetIdentity?: string; namedCardType?: KiwiCardType }
  | { type: 'resolve'; actionId: string }
  | { type: 'reset' }
type KiwiMessage =
  | { type: 'hello' | 'request' }
  | { type: 'state'; state: KiwiRoomState }
  | { type: 'command'; commandId: string; command: KiwiCommand }
  | { type: 'command-result'; commandId: string; error: string }
  | { type: 'private'; gameId: string; hand: KiwiCard[]; peek: KiwiCard[]; stash: KiwiCard[] }

const EXPANSIONS: KiwiExpansion[] = ['imploding', 'streaking', 'barking', 'zombie']
const cardTypes: KiwiCardType[] = [
  'kiwi-burst', 'leaf-helmet', 'attack', 'favor', 'nope', 'shuffle', 'skip', 'see-future-3', 'alter-future-3',
  'kiwi-cat-a', 'kiwi-cat-b', 'kiwi-cat-c', 'kiwi-cat-d', 'kiwi-cat-e', 'imploding', 'feral-kiwi', 'targeted-attack',
  'reverse', 'draw-bottom', 'streaking', 'catomic-bomb', 'mark', 'curse', 'super-skip', 'see-future-5', 'alter-future-5',
  'swap-top-bottom', 'garbage-collection', 'barking', 'alter-future-now', 'tower-of-power', 'take-that', 'potluck', 'bury',
  'personal-attack', 'share-future', 'zombie', 'attack-of-dead', 'grave-robber', 'feed-dead', 'dig-deeper', 'clone', 'clairvoyance', 'shuffle-now',
]
const isCardType = (value: unknown): value is KiwiCardType => typeof value === 'string' && cardTypes.includes(value as KiwiCardType)
const cleanText = (value: unknown, limit: number) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit)
  : ''
const identitiesInRoom = (room: Room) => [room.localParticipant.identity, ...room.remoteParticipants.keys()].filter(Boolean)
const shuffle = <T,>(items: T[]) => {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[swap]] = [result[swap], result[index]]
  }
  return result
}
const makeCard = (type: KiwiCardType, extra: Partial<KiwiCard> = {}): KiwiCard => ({ id: crypto.randomUUID(), type, ...extra })
const isCat = (type: KiwiCardType) => type.startsWith('kiwi-cat-') || type === 'feral-kiwi'
const isNowCard = (type: KiwiCardType) => ['alter-future-now', 'clairvoyance', 'feed-dead', 'shuffle-now'].includes(type)
const cardTitle = (type: KiwiCardType) => ({
  'kiwi-burst': 'Kiwi Explosivo', 'leaf-helmet': 'Folha-Segura', attack: 'Ataque', favor: 'Favor', nope: 'Não!', shuffle: 'Embaralhar', skip: 'Pular',
  'see-future-3': 'Ver o Futuro · 3', 'alter-future-3': 'Mudar o Futuro · 3', 'kiwi-cat-a': 'Kiwi A', 'kiwi-cat-b': 'Kiwi B',
  'kiwi-cat-c': 'Kiwi C', 'kiwi-cat-d': 'Kiwi D', 'kiwi-cat-e': 'Kiwi E', imploding: 'Kiwi Implosivo', 'feral-kiwi': 'Kiwi Selvagem',
  'targeted-attack': 'Ataque Direcionado', reverse: 'Reverter', 'draw-bottom': 'Comprar por Baixo', streaking: 'Kiwi Persistente', 'catomic-bomb': 'Kiwi Atômico',
  mark: 'Marcar', curse: 'Maldição do Bumbum', 'super-skip': 'Super Pulo', 'see-future-5': 'Ver o Futuro · 5', 'alter-future-5': 'Mudar o Futuro · 5',
  'swap-top-bottom': 'Trocar Topo e Fundo', 'garbage-collection': 'Coleta de Descartes', barking: 'Kiwi Latidor', 'alter-future-now': 'Mudar o Futuro · Agora',
  'tower-of-power': 'Torre do Poder', 'take-that': 'Eu Fico com Essa', potluck: 'Cada Um Dá um', bury: 'Enterrar', 'personal-attack': 'Ataque Pessoal',
  'share-future': 'Compartilhar o Futuro', zombie: 'Kiwi Zumbi', 'attack-of-dead': 'Ataque dos Mortos', 'grave-robber': 'Ladrão de Túmulos',
  'feed-dead': 'Alimentar os Mortos', 'dig-deeper': 'Cavar Mais Fundo', clone: 'Clone', clairvoyance: 'Clarividência', 'shuffle-now': 'Embaralhar · Agora',
} satisfies Record<KiwiCardType, string>)[type]

const emptyState = (controllerIdentity: string, revision = 0): KiwiRoomState => ({
  gameId: '', controllerIdentity, revision, phase: 'lobby', expansions: [], excludedCards: [], players: [], currentPlayerIdentity: '', turnsRemaining: 1,
  direction: 1, deckCount: 0, discard: [], pendingDefenseIdentity: '', pendingDefenseType: '', pendingAction: null, prompt: null,
  pendingFavor: null, barkingOwnerIdentity: '', pendingDefenseTurnIdentity: '', winnerIdentity: '', lastAction: '',
})
const parseCard = (value: unknown): KiwiCard | null => {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<KiwiCard>
  const id = cleanText(candidate.id, 64)
  return id && isCardType(candidate.type) ? {
    id, type: candidate.type, ...(candidate.faceUp ? { faceUp: true } : {}), ...(candidate.marked ? { marked: true } : {}),
    ...(typeof candidate.playedByIdentity === 'string' ? { playedByIdentity: cleanText(candidate.playedByIdentity, 128) } : {}),
  } : null
}
const parseState = (value: unknown): KiwiRoomState | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<KiwiRoomState>
  if (typeof raw.gameId !== 'string' || typeof raw.controllerIdentity !== 'string' || !Number.isInteger(raw.revision) ||
    !['lobby', 'playing', 'finished'].includes(raw.phase ?? '') || !Array.isArray(raw.players) || raw.players.length > MAX_PLAYERS ||
    !Number.isInteger(raw.deckCount) || (raw.deckCount ?? -1) < 0 || !Array.isArray(raw.discard) || !Array.isArray(raw.expansions)) return null
  const players = raw.players.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const player = entry as Partial<KiwiPlayer>
    const identity = cleanText(player.identity, 128)
    const name = cleanText(player.name, 80)
    if (!identity || !name || typeof player.alive !== 'boolean' || !Number.isInteger(player.handCount) || (player.handCount ?? -1) < 0) return []
    const explosionCard = parseCard(player.explosionCard)
    const takeThatCard = parseCard(player.takeThatCard)
    return [{ identity, name, alive: player.alive, handCount: player.handCount as number,
      ...(player.blind ? { blind: true } : {}), ...(player.tower ? { tower: true } : {}),
      ...(explosionCard ? { explosionCard } : {}), ...(isCardType(player.markedCardType) ? { markedCardType: player.markedCardType } : {}),
      ...(takeThatCard ? { takeThatCard } : {}),
      ...(typeof player.takeThatByIdentity === 'string' ? { takeThatByIdentity: cleanText(player.takeThatByIdentity, 128) } : {}),
      ...(Number.isInteger(player.stashCount) && (player.stashCount ?? -1) >= 0 ? { stashCount: Math.min(6, player.stashCount as number) } : {}) }]
  })
  if (players.length !== raw.players.length || new Set(players.map((item) => item.identity)).size !== players.length) return null
  const discard = raw.discard.flatMap((item) => { const card = parseCard(item); return card ? [card] : [] })
  const playerIds = new Set(players.map((item) => item.identity))
  const action = raw.pendingAction
  const pendingAction: KiwiPendingAction | null = action && typeof action === 'object' &&
    (isCardType(action.cardType) || ['combo-pair', 'combo-triple', 'combo-five'].includes(String(action.cardType))) &&
    Array.isArray(action.cardIds) && Number.isFinite(action.resolvesAt)
    ? { id: cleanText(action.id, 80), actorIdentity: cleanText(action.actorIdentity, 128), cardType: action.cardType as KiwiPendingAction['cardType'],
      cardIds: action.cardIds.map((item) => cleanText(item, 64)).slice(0, 5), targetIdentity: cleanText(action.targetIdentity, 128),
      secondaryTargetIdentity: cleanText(action.secondaryTargetIdentity, 128), namedCardType: isCardType(action.namedCardType) ? action.namedCardType : undefined,
      nopeCount: Math.max(0, Math.min(20, Number(action.nopeCount) || 0)), resolvesAt: Number(action.resolvesAt) }
    : null
  const promptRaw = raw.prompt
  const prompt: KiwiPrompt | null = promptRaw && typeof promptRaw === 'object' &&
    ['favor', 'insert', 'reorder', 'bury', 'give', 'reveal', 'barking', 'tower'].includes(String(promptRaw.kind))
    ? { kind: promptRaw.kind as KiwiPrompt['kind'], actorIdentity: cleanText(promptRaw.actorIdentity, 128),
      targetIdentity: cleanText(promptRaw.targetIdentity, 128), queue: Array.isArray(promptRaw.queue) ? promptRaw.queue.map((id) => cleanText(id, 128)).filter((id) => playerIds.has(id)) : [],
      label: cleanText(promptRaw.label, 120), count: Math.max(0, Math.min(10, Number(promptRaw.count) || 0)),
      ...(promptRaw.endTurnAfter ? { endTurnAfter: true } : {}) }
    : null
  const pendingFavor = raw.pendingFavor && typeof raw.pendingFavor === 'object'
    ? { fromIdentity: cleanText(raw.pendingFavor.fromIdentity, 128), toIdentity: cleanText(raw.pendingFavor.toIdentity, 128) }
    : null
  if (pendingFavor && (!playerIds.has(pendingFavor.fromIdentity) || !playerIds.has(pendingFavor.toIdentity))) return null
  return {
    gameId: cleanText(raw.gameId, 80), controllerIdentity: cleanText(raw.controllerIdentity, 128), revision: raw.revision as number,
    phase: raw.phase as KiwiPhase, expansions: raw.expansions.filter((item): item is KiwiExpansion => EXPANSIONS.includes(item as KiwiExpansion)),
    excludedCards: Array.isArray(raw.excludedCards) ? [...new Set(raw.excludedCards.filter(isCardType))] : [], players,
    currentPlayerIdentity: cleanText(raw.currentPlayerIdentity, 128), turnsRemaining: Math.max(1, Math.min(50, Number(raw.turnsRemaining) || 1)),
    direction: raw.direction === -1 ? -1 : 1, deckCount: raw.deckCount as number, discard, pendingDefenseIdentity: cleanText(raw.pendingDefenseIdentity, 128),
    pendingDefenseType: raw.pendingDefenseType === 'imploding' ? 'imploding' : raw.pendingDefenseType === 'barking' ? 'barking' : raw.pendingDefenseType === 'kiwi-burst' ? 'kiwi-burst' : '',
    pendingDefenseTurnIdentity: cleanText(raw.pendingDefenseTurnIdentity, 128),
    pendingAction, prompt, pendingFavor,
    barkingOwnerIdentity: playerIds.has(raw.barkingOwnerIdentity ?? '') ? cleanText(raw.barkingOwnerIdentity, 128) : '',
    winnerIdentity: cleanText(raw.winnerIdentity, 128), lastAction: cleanText(raw.lastAction, 160),
  }
}
const parseCommand = (value: unknown): KiwiCommand | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.type === 'draw' || raw.type === 'reset') return { type: raw.type }
  if (raw.type === 'start') return { type: 'start', expansions: Array.isArray(raw.expansions) ? raw.expansions.filter((x): x is KiwiExpansion => EXPANSIONS.includes(x as KiwiExpansion)) : [],
    excludedCards: Array.isArray(raw.excludedCards) ? [...new Set(raw.excludedCards.filter(isCardType))] : [] }
  if (raw.type === 'play' && Array.isArray(raw.cardIds)) {
    const cardIds = raw.cardIds.map((item) => cleanText(item, 64)).filter(Boolean).slice(0, 5)
    return cardIds.length ? { type: 'play', cardIds, targetIdentity: cleanText(raw.targetIdentity, 128), namedCardType: isCardType(raw.namedCardType) ? raw.namedCardType : undefined } : null
  }
  if (raw.type === 'defuse') {
    const cardId = cleanText(raw.cardId, 64); const position = Number(raw.position); const secondPosition = raw.secondPosition === undefined ? undefined : Number(raw.secondPosition)
    return cardId && Number.isInteger(position) && position >= 0 && (secondPosition === undefined || (Number.isInteger(secondPosition) && secondPosition >= 0))
      ? { type: 'defuse', cardId, position, reviveIdentity: cleanText(raw.reviveIdentity, 128), secondPosition } : null
  }
  if (raw.type === 'favor' || raw.type === 'nope') { const cardId = cleanText(raw.cardId, 64); return cardId ? { type: raw.type, cardId } : null }
  if (raw.type === 'resolve') { const actionId = cleanText(raw.actionId, 80); return actionId ? { type: 'resolve', actionId } : null }
  if (raw.type === 'choose') return { type: 'choose', cardId: cleanText(raw.cardId, 64),
    cardIds: Array.isArray(raw.cardIds) ? raw.cardIds.map((x) => cleanText(x, 64)).filter(Boolean).slice(0, 10) : undefined,
    position: raw.position === undefined ? undefined : Number(raw.position), targetIdentity: cleanText(raw.targetIdentity, 128), namedCardType: isCardType(raw.namedCardType) ? raw.namedCardType : undefined }
  return null
}

const addCards = (deck: KiwiCard[], type: KiwiCardType, count: number) => {
  for (let index = 0; index < count; index += 1) deck.push(makeCard(type))
}
const buildActionDeck = (expansions: KiwiExpansion[], playerCount: number, excludedCards: KiwiCardType[]) => {
  const deck: KiwiCard[] = []
  addCards(deck, 'attack', 4); addCards(deck, 'favor', 4); addCards(deck, 'nope', 5); addCards(deck, 'shuffle', 4)
  addCards(deck, 'skip', 4); addCards(deck, 'see-future-3', 5)
  for (const type of ['kiwi-cat-a', 'kiwi-cat-b', 'kiwi-cat-c', 'kiwi-cat-d', 'kiwi-cat-e'] as KiwiCardType[]) addCards(deck, type, 4)
  if (expansions.includes('imploding')) {
    addCards(deck, 'imploding', 1); addCards(deck, 'feral-kiwi', 4); addCards(deck, 'targeted-attack', 3)
    addCards(deck, 'reverse', 4); addCards(deck, 'draw-bottom', 4); addCards(deck, 'alter-future-3', 4)
  }
  if (expansions.includes('streaking')) {
    addCards(deck, 'streaking', 1); addCards(deck, 'kiwi-burst', 1); addCards(deck, 'catomic-bomb', 1); addCards(deck, 'mark', 3)
    addCards(deck, 'curse', 2); addCards(deck, 'super-skip', 1); addCards(deck, 'see-future-5', 1); addCards(deck, 'alter-future-5', 1)
    addCards(deck, 'swap-top-bottom', 3); addCards(deck, 'garbage-collection', 1)
  }
  if (expansions.includes('barking')) {
    addCards(deck, 'barking', 2); addCards(deck, 'alter-future-now', 2); addCards(deck, 'tower-of-power', 1); addCards(deck, 'take-that', 4)
    addCards(deck, 'potluck', 2); addCards(deck, 'bury', 2); addCards(deck, 'personal-attack', 4); addCards(deck, 'share-future', 2); addCards(deck, 'super-skip', 1)
  }
  if (expansions.includes('zombie')) {
    if (playerCount > 2) {
      addCards(deck, 'attack-of-dead', 3); addCards(deck, 'grave-robber', 1); addCards(deck, 'feed-dead', 2); addCards(deck, 'super-skip', 2)
    }
    addCards(deck, 'nope', 2); addCards(deck, 'clone', 2); addCards(deck, 'clairvoyance', 2); addCards(deck, 'dig-deeper', 2); addCards(deck, 'shuffle-now', 1)
  }
  const excluded = new Set(excludedCards)
  return deck.filter((card) => !excluded.has(card.type))
}

export const useRoomExplodingKiwi = (room: Room) => {
  const [participantRevision, setParticipantRevision] = useState(0)
  const [state, setState] = useState<KiwiRoomState>(() => emptyState(identitiesInRoom(room).sort()[0] || room.localParticipant.identity))
  const [hand, setHand] = useState<KiwiCard[]>([])
  const [peek, setPeek] = useState<KiwiCard[]>([])
  const [stash, setStash] = useState<KiwiCard[]>([])
  const [error, setError] = useState('')
  const stateRef = useRef(state)
  const handsRef = useRef<Record<string, KiwiCard[]>>({})
  const peeksRef = useRef<Record<string, KiwiCard[]>>({})
  const stashesRef = useRef<Record<string, KiwiCard[]>>({})
  const deckRef = useRef<KiwiCard[]>([])
  const discardRef = useRef<KiwiCard[]>([])
  const takenRef = useRef<Record<string, string>>({})
  const towerStashRef = useRef<KiwiCard[]>([])
  const pendingCommandsRef = useRef(new Map<string, number>())

  const applyState = useCallback((next: KiwiRoomState) => { stateRef.current = next; setState(next) }, [])
  const publish = useCallback(async (message: KiwiMessage, destinationIdentity?: string) => {
    await room.localParticipant.publishData(encoder.encode(JSON.stringify(message)), { reliable: true, topic: TOPIC,
      destinationIdentities: destinationIdentity ? [destinationIdentity] : undefined })
  }, [room])
  const getControllerIdentity = useCallback((candidate = stateRef.current) => {
    const connected = identitiesInRoom(room)
    if (candidate.gameId && candidate.controllerIdentity && connected.includes(candidate.controllerIdentity)) return candidate.controllerIdentity
    return connected.sort()[0] || room.localParticipant.identity
  }, [room])
  const sendPrivateTo = useCallback((identity: string) => {
    const current = stateRef.current
    const privateData = { type: 'private' as const, gameId: current.gameId, hand: handsRef.current[identity] ?? [],
      peek: peeksRef.current[identity] ?? [], stash: stashesRef.current[identity] ?? [] }
    if (identity === room.localParticipant.identity) { setHand(privateData.hand); setPeek(privateData.peek); setStash(privateData.stash); return }
    void publish(privateData, identity).catch(() => undefined)
  }, [publish, room])
  const sendCurrentState = useCallback((identity: string) => {
    void publish({ type: 'state', state: stateRef.current }, identity).catch(() => undefined)
    sendPrivateTo(identity)
  }, [publish, sendPrivateTo])
  const commit = useCallback((build: (current: KiwiRoomState) => KiwiRoomState) => {
    if (getControllerIdentity() !== room.localParticipant.identity) return false
    const current = stateRef.current
    const next = { ...build(current), controllerIdentity: room.localParticipant.identity, revision: current.revision + 1 }
    next.players = next.players.map((player) => ({ ...player, handCount: handsRef.current[player.identity]?.length ?? player.handCount,
      ...(player.tower ? { stashCount: stashesRef.current[player.identity]?.length ?? 0 } : { stashCount: undefined }) }))
    next.discard = [...discardRef.current]
    next.deckCount = deckRef.current.length
    applyState(next); setError('')
    void publish({ type: 'state', state: next }).catch(() => setError('A sala perdeu contato com o jogo.'))
    next.players.forEach((player) => sendPrivateTo(player.identity))
    return true
  }, [applyState, getControllerIdentity, publish, room, sendPrivateTo])

  const performCommand = useCallback((command: KiwiCommand, senderIdentity: string): string | null => {
    let current = stateRef.current
    const player = current.players.find((candidate) => candidate.identity === senderIdentity)
    const getHand = (identity: string) => handsRef.current[identity] ?? []
    const putHand = (identity: string, cards: KiwiCard[]) => { handsRef.current[identity] = cards }
    const playerName = (identity: string) => current.players.find((candidate) => candidate.identity === identity)?.name ?? 'Jogador'
    const living = () => current.players.filter((candidate) => candidate.alive)
    const nextAlive = (identity: string, direction = current.direction) => {
      const from = current.players.findIndex((candidate) => candidate.identity === identity)
      for (let step = 1; step <= current.players.length; step += 1) {
        const candidate = current.players[(from + direction * step + current.players.length * 2) % current.players.length]
        if (candidate?.alive) return candidate
      }
      return undefined
    }
    const update = (extra: Partial<KiwiRoomState> = {}) => commit((latest) => ({ ...latest, ...extra }))
    const removeFromHand = (identity: string, cardId: string): KiwiCard | null => {
      const cards = getHand(identity)
      const card = cards.find((item) => item.id === cardId)
      if (!card) return null
      const remaining = cards.filter((item) => item.id !== cardId)
      putHand(identity, remaining)
      if (card.marked) {
        current = stateRef.current
        update({ players: current.players.map((item) => item.identity === identity ? { ...item, markedCardType: undefined } : item) })
      }
      if (card.type === 'streaking' && !remaining.some((item) => item.type === 'streaking')) {
        const exposed = remaining.find((item) => item.type === 'kiwi-burst')
        if (exposed) {
          putHand(identity, remaining.filter((item) => item.id !== exposed.id))
          loseLife(identity, exposed)
        }
      }
      return { ...card, marked: false }
    }
    const discardFromHand = (identity: string, ids: string[]) => {
      const cards = getHand(identity)
      const selected = ids.map((id) => cards.find((card) => card.id === id))
      if (selected.some((card) => !card)) return null
      const removed = ids.map((id) => removeFromHand(identity, id)).filter((card): card is KiwiCard => card !== null)
      discardRef.current.push(...removed.map((card) => ({ ...card, playedByIdentity: identity })))
      return removed
    }
    const receiveCard = (identity: string, card: KiwiCard) => {
      if (card.type === 'kiwi-burst') { loseLife(identity, card); return false }
      putHand(identity, [...getHand(identity), { ...card, marked: false, playedByIdentity: undefined }])
      return true
    }
    const stealCard = (identity: string) => {
      current = stateRef.current
      const target = current.players.find((item) => item.identity === identity)
      const stashCards = stashesRef.current[identity] ?? []
      if (target?.tower && stashCards.length) {
        const index = Math.floor(Math.random() * stashCards.length)
        const [card] = stashCards.splice(index, 1)
        return card ? { ...card, marked: false } : null
      }
      const hand = getHand(identity)
      const card = hand[Math.floor(Math.random() * hand.length)]
      return card ? removeFromHand(identity, card.id) : null
    }
    const endTurn = (identity: string, all = false) => {
      current = stateRef.current
      const turns = all ? 0 : current.turnsRemaining - 1
      if (turns > 0) { update({ turnsRemaining: turns, pendingDefenseIdentity: '', pendingDefenseType: '', pendingDefenseTurnIdentity: '', pendingFavor: null, prompt: null,
        lastAction: `${playerName(identity)} ainda tem ${turns} turno${turns === 1 ? '' : 's'}.` }); return }
      const next = nextAlive(identity)
      if (living().length <= 1) {
        const winner = living()[0]
        update({ phase: 'finished', currentPlayerIdentity: winner?.identity ?? '', winnerIdentity: winner?.identity ?? '', pendingAction: null, prompt: null,
          pendingDefenseIdentity: '', pendingDefenseType: '', pendingDefenseTurnIdentity: '', pendingFavor: null, lastAction: winner ? `${winner.name} venceu a rodada.` : 'A rodada terminou.' })
      } else update({ currentPlayerIdentity: next?.identity ?? '', turnsRemaining: 1, pendingDefenseIdentity: '', pendingDefenseType: '', pendingDefenseTurnIdentity: '', pendingFavor: null, prompt: null })
    }
    const loseLife = (identity: string, card: KiwiCard, turnIdentity = identity) => {
      current = stateRef.current
      const canDefuse = getHand(identity).some((item) => item.type === 'leaf-helmet')
      const canZombie = current.expansions.includes('zombie') && getHand(identity).some((item) => item.type === 'zombie')
      const isImploding = card.type === 'imploding' && card.faceUp
      if (isImploding) {
        const dead = current.players.map((item) => item.identity === identity ? { ...item, alive: false, explosionCard: card } : item)
        update({ players: dead, lastAction: `${playerName(identity)} foi atingido pelo Kiwi Implosivo.` })
        endTurn(turnIdentity, true)
        return
      }
      if (canDefuse || canZombie) {
        update({ players: current.players.map((item) => item.identity === identity ? { ...item, explosionCard: card } : item),
          pendingDefenseIdentity: identity, pendingDefenseType: card.type === 'imploding' ? 'imploding' : card.type === 'barking' ? 'barking' : 'kiwi-burst',
          pendingDefenseTurnIdentity: turnIdentity,
          lastAction: `${playerName(identity)} comprou um Kiwi Explosivo. Resolva a defesa.` })
        return
      }
      if (current.expansions.includes('zombie')) {
        update({ players: current.players.map((item) => item.identity === identity ? { ...item, alive: false, explosionCard: card } : item),
          lastAction: `${playerName(identity)} está morto — mas ainda pode voltar.` })
      endTurn(turnIdentity, true); return
      }
      discardRef.current.push(card)
      const survivors = current.players.filter((item) => item.alive && item.identity !== identity)
      const players = current.players.map((item) => item.identity === identity ? { ...item, alive: false } : item)
      if (survivors.length <= 1) update({ phase: 'finished', players, winnerIdentity: survivors[0]?.identity ?? '', currentPlayerIdentity: survivors[0]?.identity ?? '', lastAction: `${playerName(identity)} explodiu.` })
      else { update({ players, lastAction: `${playerName(identity)} explodiu e saiu da rodada.` }); endTurn(turnIdentity, true) }
    }
    const drawFrom = (identity: string, fromBottom = false, keep = true) => {
      const card = fromBottom ? deckRef.current.shift() : deckRef.current.pop()
      if (!card) return null
      if (card.type === 'imploding' && !card.faceUp) {
        const exposed = { ...card, faceUp: true }
        peeksRef.current[identity] = [exposed]
        if (identity === room.localParticipant.identity) setPeek([exposed])
        startPrompt({ kind: 'insert', actorIdentity: identity, targetIdentity: '', queue: [], label: 'O Kiwi Implosivo volta aberto ao monte. Escolha onde colocá-lo.', count: 1, endTurnAfter: true }, `${playerName(identity)} revelou o Kiwi Implosivo.`)
        return { card, wasImplodingReveal: true }
      }
      current = stateRef.current
      const takenBy = current.players.find((item) => item.identity === identity)?.takeThatByIdentity
      if (card.type === 'kiwi-burst' && takenBy) {
        const catcher = current.players.find((item) => item.identity === identity)?.takeThatCard
        if (catcher) discardRef.current.push(catcher)
        update({ players: current.players.map((item) => item.identity === identity ? { ...item, takeThatCard: undefined, takeThatByIdentity: undefined } : item) })
        loseLife(takenBy, card, identity)
        return { card, wasExplosion: true, wasTaken: true }
      }
      if (card.type === 'kiwi-burst' && current.expansions.includes('streaking') &&
        getHand(identity).some((item) => item.type === 'streaking') && !getHand(identity).some((item) => item.type === 'kiwi-burst')) {
        putHand(identity, [...getHand(identity), card])
        return { card, wasStreakingSaved: true }
      }
      if (card.type === 'kiwi-burst' || (card.type === 'imploding' && card.faceUp)) { loseLife(takenBy ?? identity, card, identity); return { card, wasExplosion: true } }
      if (keep) {
        if (takenBy) {
          const catcher = current.players.find((item) => item.identity === identity)?.takeThatCard
          if (catcher) discardRef.current.push(catcher)
          update({ players: stateRef.current.players.map((item) => item.identity === identity ? { ...item, takeThatCard: undefined, takeThatByIdentity: undefined } : item),
            lastAction: `${playerName(takenBy)} ficou com a carta comprada por ${playerName(identity)}.` })
          receiveCard(takenBy, card)
        } else {
          putHand(identity, [...getHand(identity), card])
        }
      }
      return { card }
    }
    const openAction = (actorIdentity: string, cardType: KiwiPendingAction['cardType'], cardIds: string[], targetIdentity = '', namedCardType?: KiwiCardType) => {
      const immediate = false
      update({ pendingAction: { id: crypto.randomUUID(), actorIdentity, cardType, cardIds, targetIdentity, secondaryTargetIdentity: '', namedCardType,
        nopeCount: 0, resolvesAt: Date.now() + (immediate ? 0 : REACTION_MS) }, lastAction: `${playerName(actorIdentity)} jogou ${cardTitle(isCardType(cardType) ? cardType : 'kiwi-cat-a')}.` })
    }
    const startPrompt = (prompt: KiwiPrompt, lastAction: string) => update({ prompt, pendingAction: null, pendingDefenseIdentity: '', pendingFavor: null, lastAction })
    if (command.type === 'start') {
      if (current.phase === 'playing') return 'A rodada atual ainda está em andamento.'
      const members = [room.localParticipant, ...room.remoteParticipants.values()]
      if (members.length < 2) return 'Exploding Kiwi precisa de pelo menos duas pessoas.'
      if (members.length > MAX_PLAYERS) return `Exploding Kiwi aceita de 2 a ${MAX_PLAYERS} pessoas.`
      const expansions = [...new Set(command.expansions.filter((item) => EXPANSIONS.includes(item)))]
      const players: KiwiPlayer[] = members.map((member) => ({ identity: member.identity, name: cleanText(member.name || member.identity, 80), alive: true, handCount: 8 }))
      const excludedCards = [...new Set(command.excludedCards.filter(isCardType))]
      let actions = buildActionDeck(expansions, players.length, excludedCards)
      const towerCardIndex = actions.findIndex((card) => card.type === 'tower-of-power')
      if (towerCardIndex >= 0) {
        const [towerCard] = actions.splice(towerCardIndex, 1)
        const preparedForTower = shuffle(actions)
        towerStashRef.current = preparedForTower.splice(0, Math.min(6, preparedForTower.length))
        actions = shuffle([...preparedForTower, towerCard!])
      } else towerStashRef.current = []
      // Each player gets one Defuse, with exactly one more in the draw pile.
      let defuses = expansions.includes('zombie') ? [] : Array.from({ length: players.length + 1 }, () => makeCard('leaf-helmet'))
      let zombies = expansions.includes('zombie') ? Array.from({ length: 5 }, () => makeCard('zombie')) : []
      let imploding = actions.filter((card) => card.type === 'imploding')
      actions = actions.filter((card) => card.type !== 'imploding' && card.type !== 'kiwi-burst')
      const playersCount = players.length
      const initialExplosions = Math.max(1, playersCount - 1 + (expansions.includes('streaking') ? 1 : 0))
      let explosionCount = initialExplosions - (imploding.length ? 1 : 0)
      if (explosionCount < 0) { imploding = []; explosionCount = initialExplosions }
      const extraZombies = zombies.splice(0, playersCount)
      const hands: Record<string, KiwiCard[]> = Object.fromEntries(players.map((candidate) => [candidate.identity, []]))
      if (!expansions.includes('zombie')) {
        if (defuses.length < playersCount) return 'O baralho não tem defuses suficientes para esta combinação.'
        for (const item of players) hands[item.identity].push(defuses.pop()!)
      } else {
        if (extraZombies.length !== playersCount) return 'O pacote Zombie não tem Kiwis Zumbi suficientes.'
        players.forEach((item, index) => hands[item.identity].push(extraZombies[index]!))
      }
      const dealPool = shuffle([...actions, ...defuses, ...zombies])
      for (const item of players) for (let count = 0; count < 7; count += 1) {
        const card = dealPool.pop()
        if (!card) return 'Não foi possível montar as mãos com essa combinação de expansões.'
        hands[item.identity].push(card)
      }
      // Zombie Kittens' four-player setup puts the spare Zombie Kitten back in the draw pile.
      const spareZombie = expansions.includes('zombie') && playersCount === 4 ? zombies.shift() : undefined
      handsRef.current = hands; peeksRef.current = {}; stashesRef.current = {}; takenRef.current = {}
      deckRef.current = shuffle([...dealPool, ...imploding, ...Array.from({ length: explosionCount }, () => makeCard('kiwi-burst')), ...(spareZombie ? [spareZombie] : [])])
      discardRef.current = []; setPeek([]); setStash([])
      const first = shuffle(players)[0]
      setHand(hands[room.localParticipant.identity] ?? [])
      const gameId = crypto.randomUUID()
      commit(() => ({ ...emptyState(room.localParticipant.identity), gameId, phase: 'playing', expansions, excludedCards, players,
        currentPlayerIdentity: first?.identity ?? '', turnsRemaining: 1, deckCount: deckRef.current.length,
        lastAction: `${first?.name ?? 'A primeira pessoa'} começa. Jogue quantas cartas quiser e compre para encerrar.` }))
      return null
    }
    if (command.type === 'reset') {
      handsRef.current = {}; peeksRef.current = {}; stashesRef.current = {}; takenRef.current = {}; towerStashRef.current = []; deckRef.current = []; discardRef.current = []
      setHand([]); setPeek([]); setStash([]); commit((latest) => emptyState(room.localParticipant.identity, latest.revision)); return null
    }
    if (!current.gameId || current.phase !== 'playing') return 'Não há uma partida ativa.'

    if (command.type === 'resolve') {
      const action = current.pendingAction
      if (!action || action.id !== command.actionId) return null
      if (action.nopeCount % 2 === 1) { update({ pendingAction: null, lastAction: 'A ação foi anulada por um Não!' }); return null }
      const actor = action.actorIdentity
      const target = action.targetIdentity || nextAlive(actor)?.identity || ''
      const title = isCardType(action.cardType) ? action.cardType : null
      update({ pendingAction: null })
      if (action.cardType === 'combo-pair' || action.cardType === 'combo-triple') {
        if (target && getHand(target).length) {
          if (action.cardType === 'combo-triple' && action.namedCardType) {
            const match = getHand(target).find((card) => card.type === action.namedCardType)
            if (match) receiveCard(actor, removeFromHand(target, match.id)!)
          } else {
            const stolen = stealCard(target)
            if (stolen) receiveCard(actor, stolen)
          }
        }
        update({ lastAction: `${playerName(actor)} roubou uma carta de ${playerName(target)}.` }); return null
      }
      if (action.cardType === 'combo-five') {
        if (action.namedCardType) {
          const found = [...discardRef.current].reverse().find((card) => card.type === action.namedCardType)
          if (found) { discardRef.current.splice(discardRef.current.indexOf(found), 1); receiveCard(actor, found) }
        }
        update({ lastAction: `${playerName(actor)} pegou uma carta do descarte.` }); return null
      }
      if (!title) return null
      if (title === 'skip' || title === 'super-skip') { endTurn(actor, title === 'super-skip'); return null }
      if (title === 'attack' || title === 'attack-of-dead') {
        const next = nextAlive(actor)
        if (title === 'attack-of-dead' && !current.players.some((item) => !item.alive)) { endTurn(actor); return null }
        const carry = current.currentPlayerIdentity === actor && current.turnsRemaining > 1 ? current.turnsRemaining : 0
        if (next) update({ currentPlayerIdentity: next.identity, turnsRemaining: carry + (title === 'attack-of-dead' ? 3 * current.players.filter((item) => !item.alive).length : 2) })
        return null
      }
      if (title === 'targeted-attack') {
        const chosen = current.players.find((item) => item.identity === target && item.alive)
        const carry = current.currentPlayerIdentity === actor && current.turnsRemaining > 1 ? current.turnsRemaining : 0
        if (chosen) update({ currentPlayerIdentity: chosen.identity, turnsRemaining: carry + 2 })
        return null
      }
      if (title === 'personal-attack') { update({ currentPlayerIdentity: actor, turnsRemaining: current.turnsRemaining + 2 }); return null }
      if (title === 'favor') {
        if (current.players.find((item) => item.identity === target)?.tower) { update({ lastAction: 'A Torre do Poder protegeu a mão do Favor.' }); return null }
        startPrompt({ kind: 'favor', actorIdentity: actor, targetIdentity: target, queue: [], label: 'Escolha uma carta para entregar.', count: 1 }, `${playerName(target)} deve entregar uma carta a ${playerName(actor)}.`); return null
      }
      if (title === 'shuffle' || title === 'shuffle-now') { deckRef.current = shuffle(deckRef.current); update({ lastAction: `${playerName(actor)} embaralhou o monte.` }); return null }
      if (title === 'see-future-3' || title === 'see-future-5' || title === 'clairvoyance') {
        const count = title === 'see-future-5' ? 5 : title === 'clairvoyance' ? 1 : 3; const cards = deckRef.current.slice(-count).reverse()
        peeksRef.current[actor] = cards; if (actor === room.localParticipant.identity) setPeek(cards)
        update({ lastAction: `${playerName(actor)} viu o topo do monte em segredo.` }); return null
      }
      if (title === 'alter-future-3' || title === 'alter-future-5' || title === 'alter-future-now' || title === 'share-future') {
        const next = nextAlive(actor)
        const count = title === 'alter-future-5' ? 5 : 3
        const cards = deckRef.current.slice(-count).reverse(); peeksRef.current[actor] = cards
        if (actor === room.localParticipant.identity) setPeek(cards)
        if (title === 'share-future' && next) { peeksRef.current[next.identity] = cards; sendPrivateTo(next.identity) }
        startPrompt({ kind: 'reorder', actorIdentity: actor, targetIdentity: title === 'share-future' ? next?.identity ?? '' : actor, queue: [], label: 'Reordene as cartas do topo; a primeira fica no topo.', count: cards.length }, 'O topo do monte foi revelado em segredo.')
        return null
      }
      if (title === 'reverse') {
        if (living().length === 2) { endTurn(actor); return null }
        update({ direction: current.direction === 1 ? -1 : 1, currentPlayerIdentity: nextAlive(actor, current.direction === 1 ? -1 : 1)?.identity ?? '', turnsRemaining: 1 }); return null
      }
      if (title === 'draw-bottom') {
        const drawn = drawFrom(actor, true)
        if (drawn?.wasExplosion || drawn?.wasImplodingReveal) return null
        endTurn(actor)
        return null
      }
      if (title === 'dig-deeper') {
        const result = drawFrom(actor, false, false)
        if (result?.wasExplosion || result?.wasImplodingReveal) return null
        if (result?.card) {
          peeksRef.current[actor] = [result.card]; if (actor === room.localParticipant.identity) setPeek([result.card])
          startPrompt({ kind: 'reveal', actorIdentity: actor, targetIdentity: '', queue: [], label: 'Decida se fica com esta carta. Se não, compre a próxima.', count: 1 }, 'Cavou uma carta do topo.')
        } else endTurn(actor)
        return null
      }
      if (title === 'catomic-bomb') {
        const bombs = deckRef.current.filter((card) => card.type === 'kiwi-burst')
        deckRef.current = [...shuffle(deckRef.current.filter((card) => card.type !== 'kiwi-burst')), ...bombs.reverse()]
        endTurn(actor); return null
      }
      if (title === 'swap-top-bottom') {
        if (deckRef.current.length > 1) [deckRef.current[0], deckRef.current[deckRef.current.length - 1]] = [deckRef.current[deckRef.current.length - 1], deckRef.current[0]]
        update(); return null
      }
      if (title === 'mark') {
        const targetPlayer = current.players.find((item) => item.identity === target && item.alive)
        const cards = targetPlayer ? getHand(target) : []
        const marked = cards[Math.floor(Math.random() * cards.length)]
        if (marked) { marked.marked = true; update({ players: current.players.map((item) => item.identity === target ? { ...item, markedCardType: marked.type } : item) }) }
        return null
      }
      if (title === 'curse') { update({ players: current.players.map((item) => item.identity === target ? { ...item, blind: true } : item), lastAction: `${playerName(target)} está com a mão virada.` }); return null }
      if (title === 'take-that') {
        const targetPlayer = current.players.find((item) => item.identity === target)
        if (!targetPlayer || targetPlayer.takeThatCard) {
          update({ lastAction: 'Essa pessoa já tem uma carta Eu Fico com Essa pendente.' })
          return null
        }
        const playedCard = action.cardIds.map((id) => discardRef.current.find((card) => card.id === id)).find((card) => card?.type === 'take-that')
        if (!playedCard) return null
        discardRef.current = discardRef.current.filter((card) => card.id !== playedCard.id)
        update({ players: current.players.map((item) => item.identity === target ? { ...item, takeThatCard: playedCard, takeThatByIdentity: actor } : item),
          lastAction: `${playerName(target)} deverá entregar a próxima carta comprada a ${playerName(actor)}.` })
        endTurn(actor); return null
      }
      if (title === 'tower-of-power') {
        update({ players: current.players.map((item) => item.identity === actor ? { ...item, tower: true } : item) })
        stashesRef.current[actor] = towerStashRef.current.splice(0)
        if (actor === room.localParticipant.identity) setStash(stashesRef.current[actor] ?? [])
        update({ lastAction: `${playerName(actor)} ativou a Torre do Poder.` }); return null
      }
      if (title === 'barking') {
        const actorHasTwin = discardRef.current.some((item) => item.type === 'barking' && item.id !== action.cardIds[0])
        if (actorHasTwin && target) {
          const victimHasTwin = getHand(target).find((item) => item.type === 'barking')
          if (victimHasTwin) {
            putHand(target, getHand(target).filter((item) => item.id !== victimHasTwin.id)); discardRef.current.push(victimHasTwin)
            loseLife(target, makeCard('kiwi-burst'))
          }
        }
        return null
      }
      if (title === 'garbage-collection' || title === 'potluck' || title === 'grave-robber' || title === 'feed-dead') {
        let queue = title === 'grave-robber' ? current.players.filter((item) => !item.alive && getHand(item.identity).length).map((item) => item.identity)
          : title === 'feed-dead' ? current.players.filter((item) => item.alive && item.identity !== actor).map((item) => item.identity)
            : current.players.filter((item) => item.alive).map((item) => item.identity)
        if ((title === 'grave-robber' || title === 'feed-dead') && !current.players.some((item) => !item.alive)) { update({ lastAction: 'Não há pessoas mortas para esta carta.' }); return null }
        if (!queue.length) { update(); return null }
        startPrompt({ kind: 'give', actorIdentity: actor, targetIdentity: title === 'feed-dead' ? action.targetIdentity : '', queue,
          label: title === 'potluck' ? 'Cada pessoa viva escolhe uma carta para pôr no monte.' : title === 'garbage-collection' ? 'Cada pessoa viva escolhe uma carta para devolver ao monte.' : title === 'grave-robber' ? 'Cada pessoa morta escolhe uma carta para devolver ao monte.' : 'Escolha uma carta para entregar a alguém que está morto.', count: 1 }, 'Escolhas de carta pendentes.')
        return null
      }
      if (title === 'bury') {
        const result = drawFrom(actor, false, false)
        if (result?.wasExplosion || result?.wasImplodingReveal) return null
        if (result?.card) {
          peeksRef.current[actor] = [result.card]; if (actor === room.localParticipant.identity) setPeek([result.card])
          startPrompt({ kind: 'bury', actorIdentity: actor, targetIdentity: '', queue: [], label: 'Insira a carta comprada em qualquer ponto do monte.', count: 1, endTurnAfter: true }, 'Escolha em que ponto do monte devolver a carta.')
        } else endTurn(actor)
        return null
      }
      if (title === 'clone') {
        const top = discardRef.current.at(-2)
        if (top && top.type !== 'clone') {
          const virtual = makeCard(top.type)
          if (top.type === 'skip' || top.type === 'super-skip') endTurn(actor, top.type === 'super-skip')
          else if (top.type === 'attack') { const next = nextAlive(actor); if (next) update({ currentPlayerIdentity: next.identity, turnsRemaining: current.turnsRemaining + 2 }) }
          else if (top.type === 'shuffle') deckRef.current = shuffle(deckRef.current)
          else if (top.type === 'see-future-3') { const cards = deckRef.current.slice(-3).reverse(); peeksRef.current[actor] = cards; setPeek(actor === room.localParticipant.identity ? cards : peek) }
          else if (top.type === 'zombie') { putHand(actor, [...getHand(actor), virtual]); update() }
          else update({ lastAction: `${playerName(actor)} clonou ${cardTitle(top.type)}.` })
        }
        return null
      }
      update({ lastAction: `${playerName(actor)} resolveu ${cardTitle(title)}.` })
      return null
    }

      if (command.type === 'nope') {
      const card = getHand(senderIdentity).find((item) => item.id === command.cardId && item.type === 'nope')
      if (!card || !current.pendingAction) return 'Não há uma ação para anular.'
      if (!player?.alive && !current.expansions.includes('zombie')) return 'Só pessoas vivas podem jogar nesta janela.'
      discardFromHand(senderIdentity, [command.cardId])
      update({ pendingAction: { ...current.pendingAction, nopeCount: current.pendingAction.nopeCount + 1, resolvesAt: Date.now() + REACTION_MS },
        lastAction: `${playerName(senderIdentity)} jogou ${current.pendingAction.nopeCount % 2 === 0 ? 'Não!' : 'Yup!'}.` })
      return null
    }
    if (command.type === 'defuse') {
      if (current.pendingDefenseIdentity !== senderIdentity) return 'Não há um kiwi explosivo aguardando sua resposta.'
      const cards = getHand(senderIdentity)
      const defensive = cards.find((item) => item.id === command.cardId && (item.type === 'leaf-helmet' || (current.pendingDefenseType !== 'barking' && item.type === 'zombie')))
      if (!defensive) return 'Escolha uma Folha-Segura ou Kiwi Zumbi da sua mão.'
      const wasZombie = defensive.type === 'zombie'
      const explodedPlayer = current.players.find((item) => item.identity === senderIdentity)
      const explosion = explodedPlayer?.explosionCard
      const isBarking = current.pendingDefenseType === 'barking'
      const deadPlayers = isBarking ? [] : current.players.filter((item) => !item.alive && item.identity !== senderIdentity)
      const revivedIdentity = command.reviveIdentity ?? ''
      const revivedPlayer = deadPlayers.find((item) => item.identity === revivedIdentity)
      if (wasZombie && deadPlayers.length && !revivedPlayer) return 'Escolha uma pessoa morta para trazer de volta antes de confirmar.'
      discardFromHand(senderIdentity, [defensive.id])
      if (!isBarking && explosion) deckRef.current.splice(Math.max(0, Math.min(command.position, deckRef.current.length)), 0,
        explosion.type === 'imploding' ? { ...explosion, faceUp: true } : explosion)
      if (wasZombie && revivedPlayer?.explosionCard) {
        deckRef.current.splice(Math.max(0, Math.min(command.secondPosition ?? deckRef.current.length, deckRef.current.length)), 0, revivedPlayer.explosionCard)
      }
      const updatedPlayers = current.players.map((item) => {
        if (item.identity === senderIdentity) return { ...item, explosionCard: undefined, ...(isBarking ? { markedCardType: undefined } : {}) }
        if (wasZombie && item.identity === revivedIdentity) return { ...item, alive: true, explosionCard: undefined }
        if (isBarking && item.markedCardType === 'barking') return { ...item, markedCardType: undefined }
        return item
      })
      const interruptedTurn = current.pendingDefenseTurnIdentity || senderIdentity
      update({ players: updatedPlayers, pendingDefenseIdentity: '', pendingDefenseType: '', pendingDefenseTurnIdentity: '', lastAction: `${playerName(senderIdentity)} evitou a explosão.` })
      if (wasZombie) endTurn(interruptedTurn)
      else if (!isBarking) endTurn(interruptedTurn)
      return null
    }

    if (command.type === 'favor') {
      if (!current.pendingFavor || current.pendingFavor.toIdentity !== senderIdentity) return 'Não há um Favor esperando por você.'
      const given = getHand(senderIdentity).find((item) => item.id === command.cardId)
      if (!given || !current.players.find((item) => item.identity === senderIdentity)?.alive) return 'Escolha uma carta válida.'
      discardFromHand(senderIdentity, [])
      const received = removeFromHand(senderIdentity, given.id)
      if (received) receiveCard(current.pendingFavor.fromIdentity, received)
      update({ pendingFavor: null, lastAction: `${playerName(senderIdentity)} entregou uma carta.` }); return null
    }

    if (command.type === 'choose') {
      const prompt = current.prompt
      if (!prompt) return 'Não há nenhuma escolha aguardando.'
      const canChoose = prompt.kind === 'favor' ? senderIdentity === prompt.targetIdentity
        : prompt.kind === 'give' ? prompt.queue[0] === senderIdentity
          : prompt.actorIdentity === senderIdentity
      if (!canChoose) return 'A escolha pertence a outra pessoa.'
      if (prompt.kind === 'favor') {
        const card = getHand(senderIdentity).find((item) => item.id === command.cardId)
        if (!card) return 'Escolha uma carta da sua mão.'
        const received = removeFromHand(senderIdentity, card.id)
        if (received) receiveCard(prompt.actorIdentity, received)
        update({ prompt: null, lastAction: `${playerName(senderIdentity)} entregou uma carta a ${playerName(prompt.actorIdentity)}.` }); return null
      }
      if (prompt.kind === 'insert' || prompt.kind === 'bury') {
        const position = Math.max(0, Math.min(command.position ?? 0, deckRef.current.length))
        const card = peeksRef.current[prompt.actorIdentity]?.[0]
        if (!card) return 'A carta privada não está disponível; peça sincronização antes de continuar.'
        deckRef.current.splice(position, 0, card); peeksRef.current[prompt.actorIdentity] = []; setPeek([])
        update({ prompt: null, pendingDefenseIdentity: '', lastAction: `${playerName(prompt.actorIdentity)} inseriu uma carta no monte.` })
        if (prompt.endTurnAfter) endTurn(prompt.actorIdentity)
        return null
      }
      if (prompt.kind === 'reorder') {
        const ids = command.cardIds ?? []
        const available = peeksRef.current[senderIdentity] ?? []
        if (!ids.length || ids.length !== available.length || new Set(ids).size !== available.length) return 'Reordene todas as cartas reveladas.'
        const ordered = ids.map((id) => available.find((card) => card.id === id)).filter((card): card is KiwiCard => Boolean(card))
        if (ordered.length !== available.length) return 'A ordem enviada não corresponde às cartas reveladas.'
        deckRef.current.splice(Math.max(0, deckRef.current.length - ordered.length), ordered.length, ...ordered.reverse())
        peeksRef.current[senderIdentity] = []; setPeek([]); update({ prompt: null, lastAction: `${playerName(senderIdentity)} reorganizou o topo do monte.` }); return null
      }
      if (prompt.kind === 'give') {
        const card = getHand(senderIdentity).find((item) => item.id === command.cardId)
        if (!card) return 'Escolha uma carta da sua mão.'
        const removed = removeFromHand(senderIdentity, card.id)
        if (!removed) return 'Não foi possível retirar essa carta da sua mão.'
        if (prompt.label.startsWith('Cada pessoa viva escolhe')) {
          deckRef.current.push(removed)
        } else if (prompt.label.startsWith('Cada pessoa morta')) deckRef.current.push(removed)
        else if (prompt.label.startsWith('Escolha uma carta para entregar')) receiveCard(prompt.targetIdentity, removed)
        const remaining = prompt.queue.slice(1)
        if (remaining.length) update({ prompt: { ...prompt, queue: remaining } })
        else {
          if (prompt.label.startsWith('Cada pessoa viva escolhe uma carta para devolver') || prompt.label.startsWith('Cada pessoa morta')) deckRef.current = shuffle(deckRef.current)
          update({ prompt: null, lastAction: 'As cartas escolhidas foram resolvidas.' })
          if (prompt.label.startsWith('Cada pessoa viva escolhe uma carta para devolver')) endTurn(prompt.actorIdentity)
        }
        return null
      }
      if (prompt.kind === 'reveal') {
        const drawn = peeksRef.current[prompt.actorIdentity]?.[0]
        if (!drawn) return 'Não há carta revelada.'
        if (command.cardId === drawn.id) {
          peeksRef.current[prompt.actorIdentity] = []; setPeek([]); update({ prompt: null })
          if (drawn.type === 'kiwi-burst' || (drawn.type === 'imploding' && drawn.faceUp)) loseLife(prompt.actorIdentity, drawn)
          else { putHand(prompt.actorIdentity, [...getHand(prompt.actorIdentity), drawn]); endTurn(prompt.actorIdentity) }
        } else {
          const second = drawFrom(prompt.actorIdentity)
          deckRef.current.push(drawn)
          if (second?.wasImplodingReveal) return null
          peeksRef.current[prompt.actorIdentity] = []; setPeek([]); update({ prompt: null })
          if (!second?.wasExplosion) endTurn(prompt.actorIdentity)
        }
        return null
      }
      if (prompt.kind === 'tower') {
        const selected = getHand(senderIdentity).find((item) => item.id === command.cardId)
        if (!selected) return 'Escolha uma carta para guardar.'
        putHand(senderIdentity, getHand(senderIdentity).filter((item) => item.id !== selected.id)); stashesRef.current[senderIdentity] = [...(stashesRef.current[senderIdentity] ?? []), selected]
        sendPrivateTo(senderIdentity); update({ prompt: null }); return null
      }
      if (prompt.kind === 'barking') {
        const victim = current.players.find((item) => item.identity === command.targetIdentity && item.alive)
        if (!victim) return 'Escolha uma pessoa viva.'
        update({ prompt: null }); loseLife(victim.identity, makeCard('kiwi-burst')); return null
      }
      return null
    }

    if (command.type === 'play') {
      const requestedCard = getHand(senderIdentity).find((item) => item.id === command.cardIds[0])
      if (!player?.alive && !(current.expansions.includes('zombie') && requestedCard && (requestedCard.type === 'nope' || isNowCard(requestedCard.type)))) return 'Você está fora da rodada e só pode jogar cartas “Agora” ou Nope.'
      if (current.pendingAction) return 'Espere a janela de Nope terminar.'
      if (current.pendingDefenseIdentity || current.pendingFavor || current.prompt) return 'Resolva primeiro a ação pendente.'
      if (current.currentPlayerIdentity !== senderIdentity && !(requestedCard && (requestedCard.type === 'nope' || isNowCard(requestedCard.type)))) return 'Ainda não é sua vez.'
      const actualIds = player?.blind ? [getHand(senderIdentity)[Math.floor(Math.random() * getHand(senderIdentity).length)]?.id ?? ''] : command.cardIds
      const cards = actualIds.map((id) => getHand(senderIdentity).find((item) => item.id === id))
      if (cards.some((card) => !card)) return 'Uma das cartas escolhidas não está na sua mão.'
      const selected = cards as KiwiCard[]
      const primary = selected[0]!
      if (player?.blind && selected.length > 1) return 'Com a mão amaldiçoada, jogue uma carta por vez.'
      if (selected.length > 1) {
        const zombieRules = current.expansions.includes('zombie')
        const sameTitle = selected.every((item) => item.type === primary.type)
        const catSet = selected.every((item) => isCat(item.type))
        const hasWildCat = catSet && selected.some((item) => item.type === 'feral-kiwi')
        const validPair = selected.length === 2 && ((sameTitle && (zombieRules || isCat(primary.type))) || hasWildCat)
        const validTriple = selected.length === 3 && ((sameTitle && (zombieRules || isCat(primary.type))) || hasWildCat)
        const validFive = selected.length === 5 && new Set(selected.map((item) => item.type)).size === 5
        if (!validPair && !validTriple && !validFive) return 'Essa combinação não é válida pelas regras desta partida.'
        const target = current.players.find((item) => item.identity === command.targetIdentity && item.alive && item.identity !== senderIdentity)
        if (!validFive && !target) return 'Escolha outra pessoa viva para o combo.'
        const taken = discardFromHand(senderIdentity, selected.map((item) => item.id))
        if (!taken) return 'Não consegui remover as cartas do combo.'
        const comboType = validFive ? 'combo-five' : validTriple ? 'combo-triple' : 'combo-pair'
        openAction(senderIdentity, comboType, selected.map((item) => item.id), command.targetIdentity, command.namedCardType)
        return null
      }
      if (primary.type === 'leaf-helmet' || primary.type === 'kiwi-burst' || primary.type === 'imploding' || primary.type === 'zombie' || primary.type === 'streaking') {
        if (player?.blind) { discardFromHand(senderIdentity, [primary.id]); update({ lastAction: `${playerName(senderIdentity)} descartou uma carta sem conseguir identificá-la.` }); return null }
        return 'Esta carta só pode ser usada na defesa ou na condição indicada.'
      }
      if (primary.type === 'nope') return 'Use Não! durante a janela de resposta.'
      if (isCat(primary.type)) return 'Cartas de Kiwi só podem ser jogadas em combos.'
      const randomTarget = player?.blind ? shuffle(current.players.filter((item) => item.alive && item.identity !== senderIdentity))[0]?.identity : ''
      const targetIdentity = player?.blind ? randomTarget ?? '' : command.targetIdentity
      const targeted = ['favor', 'targeted-attack', 'curse', 'mark', 'take-that', 'feed-dead'].includes(primary.type)
      const target = targeted ? current.players.find((item) => item.identity === targetIdentity &&
        (primary.type === 'feed-dead' ? !item.alive : item.alive && (primary.type === 'targeted-attack' || item.identity !== senderIdentity))) : undefined
      if (targeted && !target) return 'Selecione outra pessoa viva como alvo.'
      if (primary.type === 'take-that' && target?.takeThatCard) return 'Essa pessoa já tem uma carta Eu Fico com Essa pendente.'
      if (primary.type === 'feed-dead' && !current.players.some((item) => !item.alive)) return 'Não há pessoas mortas para alimentar.'
      if (primary.type === 'grave-robber' && !current.players.some((item) => !item.alive && getHand(item.identity).length)) return 'Não há mãos de pessoas mortas para saquear.'
      if (primary.type === 'barking') {
        putHand(senderIdentity, getHand(senderIdentity).filter((item) => item.id !== primary.id))
        const mateOwner = current.players.find((item) => item.alive && item.identity !== senderIdentity && getHand(item.identity).some((card) => card.type === 'barking'))
        const players = current.players.map((item) => item.identity === senderIdentity || item.identity === mateOwner?.identity ? { ...item, markedCardType: 'barking' as const } : item)
        if (mateOwner) {
          const mate = getHand(mateOwner.identity).find((item) => item.type === 'barking')!
          putHand(mateOwner.identity, getHand(mateOwner.identity).filter((item) => item.id !== mate.id))
          if (getHand(mateOwner.identity).some((item) => item.type === 'leaf-helmet')) {
            update({ players, pendingDefenseIdentity: mateOwner.identity, pendingDefenseType: 'barking', lastAction: `${playerName(mateOwner.identity)} deve se defender do Kiwi Latidor.` })
          } else {
            const survivors = players.filter((item) => item.alive && item.identity !== mateOwner.identity)
            const eliminated = players.map((item) => item.identity === mateOwner.identity ? { ...item, alive: false, explosionCard: makeCard('barking') } : item)
            if (survivors.length <= 1) update({ phase: 'finished', players: eliminated, winnerIdentity: survivors[0]?.identity ?? '', currentPlayerIdentity: survivors[0]?.identity ?? '', lastAction: `${playerName(mateOwner.identity)} foi eliminado pelo Kiwi Latidor.` })
            else update({ players: eliminated, lastAction: `${playerName(mateOwner.identity)} foi atingido pelo Kiwi Latidor.` })
          }
        } else update({ players, lastAction: 'O Kiwi Latidor ficou exposto na mesa.' })
        return null
      }
      discardFromHand(senderIdentity, [primary.id])
      if (primary.type === 'alter-future-now' || primary.type === 'clairvoyance' || primary.type === 'feed-dead') {
        // “Now” cards resolve outside the ordinary turn and are not subject to Nope.
        discardRef.current.push(primary)
        const actionType: KiwiPendingAction['cardType'] = primary.type
        openAction(senderIdentity, actionType, [primary.id], targetIdentity)
        return null
      }
      openAction(senderIdentity, primary.type, [primary.id], targetIdentity)
      return null
    }

    if (command.type === 'draw') {
      if (!player?.alive || current.currentPlayerIdentity !== senderIdentity || current.pendingAction || current.pendingDefenseIdentity || current.pendingFavor || current.prompt) return 'Ainda não é sua vez de comprar.'
      const result = drawFrom(senderIdentity)
      if (!result) return 'O monte está vazio.'
      current = stateRef.current
      if (result.wasExplosion) {
        return null
      }
      if (result.wasImplodingReveal) return null
      if (player.blind) update({ players: current.players.map((item) => item.identity === senderIdentity ? { ...item, blind: false } : item), lastAction: `${playerName(senderIdentity)} conseguiu comprar e encerrou a maldição.` })
      peeksRef.current[senderIdentity] = []; setPeek([]); endTurn(senderIdentity); return null
    }
    return null
  }, [commit, peek, room, sendPrivateTo])

  const ensureController = useCallback(() => {
    if (getControllerIdentity() !== room.localParticipant.identity) return false
    if (stateRef.current.controllerIdentity === room.localParticipant.identity) return true
    const wasActive = Boolean(stateRef.current.gameId)
    handsRef.current = {}; peeksRef.current = {}; stashesRef.current = {}; deckRef.current = []; discardRef.current = []; takenRef.current = {}
    setHand([]); setPeek([]); setStash([])
    const next = emptyState(room.localParticipant.identity, stateRef.current.revision + 1); applyState(next)
    if (wasActive) setError('Quem controlava a partida saiu. A rodada foi encerrada para proteger as mãos privadas.')
    void publish({ type: 'state', state: next }).catch(() => undefined)
    return true
  }, [applyState, getControllerIdentity, publish, room])
  const dispatch = useCallback((command: KiwiCommand) => {
    setError('')
    const controller = getControllerIdentity()
    if (controller === room.localParticipant.identity) { ensureController(); const result = performCommand(command, room.localParticipant.identity); if (result) setError(result); return !result }
    const commandId = crypto.randomUUID()
    const timeout = window.setTimeout(() => { pendingCommandsRef.current.delete(commandId); setError('O jogo não respondeu na sala. Tente novamente.') }, 5_000)
    pendingCommandsRef.current.set(commandId, timeout)
    void publish({ type: 'command', commandId, command }, controller).catch(() => { window.clearTimeout(timeout); pendingCommandsRef.current.delete(commandId); setError('Não foi possível enviar sua ação para o jogo.') })
    return true
  }, [ensureController, getControllerIdentity, performCommand, publish, room])

  useEffect(() => {
    const action = state.pendingAction
    if (!action || !state.gameId || getControllerIdentity() !== room.localParticipant.identity) return
    const timer = window.setTimeout(() => dispatch({ type: 'resolve', actionId: action.id }), Math.max(0, action.resolvesAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [dispatch, getControllerIdentity, room, state.gameId, state.pendingAction])
  useEffect(() => {
    const receive = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== TOPIC || !participant) return
      let message: KiwiMessage
      try { message = JSON.parse(decoder.decode(payload)) as KiwiMessage } catch { return }
      if (message.type === 'hello' || message.type === 'request') {
        if (ensureController()) sendCurrentState(participant.identity)
        else void publish({ type: 'request' }, getControllerIdentity()).catch(() => undefined)
        return
      }
      if (message.type === 'state') {
        const candidate = parseState(message.state)
        if (!candidate || participant.identity !== candidate.controllerIdentity) return
        const current = stateRef.current
        if (candidate.controllerIdentity === current.controllerIdentity && candidate.revision <= current.revision) return
        applyState(candidate)
        if (!candidate.gameId || candidate.gameId !== current.gameId) { setHand([]); setPeek([]); setStash([]) }
        if (candidate.gameId && candidate.players.some((item) => item.identity === room.localParticipant.identity)) void publish({ type: 'request' }, candidate.controllerIdentity).catch(() => undefined)
        return
      }
      if (message.type === 'private') {
        const current = stateRef.current
        if (participant.identity !== current.controllerIdentity || message.gameId !== current.gameId || !current.players.some((item) => item.identity === room.localParticipant.identity)) return
        setHand(Array.isArray(message.hand) ? message.hand.flatMap((card) => { const parsed = parseCard(card); return parsed ? [parsed] : [] }) : [])
        setPeek(Array.isArray(message.peek) ? message.peek.flatMap((card) => { const parsed = parseCard(card); return parsed ? [parsed] : [] }) : [])
        setStash(Array.isArray(message.stash) ? message.stash.flatMap((card) => { const parsed = parseCard(card); return parsed ? [parsed] : [] }) : [])
        return
      }
      if (message.type === 'command') {
        if (getControllerIdentity() !== room.localParticipant.identity || !ensureController()) return
        const command = parseCommand(message.command); const commandId = cleanText(message.commandId, 64)
        if (!command || !commandId) return
        const commandError = performCommand(command, participant.identity)
        void publish({ type: 'command-result', commandId, error: commandError ?? '' }, participant.identity).catch(() => undefined)
        return
      }
      if (message.type === 'command-result') {
        const commandId = cleanText(message.commandId, 64); const timeout = pendingCommandsRef.current.get(commandId)
        if (timeout === undefined || participant.identity !== getControllerIdentity()) return
        window.clearTimeout(timeout); pendingCommandsRef.current.delete(commandId); setError(cleanText(message.error, 240))
      }
    }
    const onParticipantConnected = (participant?: RemoteParticipant) => {
      void publish({ type: 'hello' }).catch(() => undefined)
      if (participant && ensureController()) sendCurrentState(participant.identity)
      else void publish({ type: 'request' }, getControllerIdentity()).catch(() => undefined)
      setParticipantRevision((revision) => revision + 1)
    }
    const onParticipantDisconnected = (participant?: RemoteParticipant) => { setParticipantRevision((revision) => revision + 1); if (participant?.identity === stateRef.current.controllerIdentity) ensureController() }
    room.on(RoomEvent.DataReceived, receive); room.on(RoomEvent.ParticipantConnected, onParticipantConnected)
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected); room.on(RoomEvent.Reconnected, onParticipantConnected)
    void publish({ type: 'hello' }).catch(() => undefined)
    const requestTimer = window.setTimeout(() => { if (!ensureController()) void publish({ type: 'request' }, getControllerIdentity()).catch(() => undefined) }, 700)
    return () => {
      window.clearTimeout(requestTimer); room.off(RoomEvent.DataReceived, receive); room.off(RoomEvent.ParticipantConnected, onParticipantConnected)
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected); room.off(RoomEvent.Reconnected, onParticipantConnected)
      for (const timeout of pendingCommandsRef.current.values()) window.clearTimeout(timeout); pendingCommandsRef.current.clear()
    }
  }, [applyState, ensureController, getControllerIdentity, performCommand, publish, room, sendCurrentState])

  const start = useCallback((expansions: KiwiExpansion[] = [], excludedCards: KiwiCardType[] = []) => dispatch({ type: 'start', expansions, excludedCards }), [dispatch])
  const reset = useCallback(() => dispatch({ type: 'reset' }), [dispatch])
  const draw = useCallback(() => dispatch({ type: 'draw' }), [dispatch])
  const play = useCallback((cardIds: string[], targetIdentity = '', namedCardType?: KiwiCardType) => dispatch({ type: 'play', cardIds, targetIdentity, namedCardType }), [dispatch])
  const defuse = useCallback((cardId: string, position: number, reviveIdentity?: string, secondPosition?: number) => dispatch({ type: 'defuse', cardId, position, reviveIdentity, secondPosition }), [dispatch])
  const favor = useCallback((cardId: string) => dispatch({ type: 'favor', cardId }), [dispatch])
  const nope = useCallback((cardId: string) => dispatch({ type: 'nope', cardId }), [dispatch])
  const choose = useCallback((choice: Omit<Extract<KiwiCommand, { type: 'choose' }>, 'type'>) => dispatch({ type: 'choose', ...choice }), [dispatch])
  const clearError = useCallback(() => setError(''), [])
  const controllerIdentity = getControllerIdentity(state)
  void participantRevision
  return {
    state, hand, peek, stash, error, clearError,
    isController: controllerIdentity === room.localParticipant.identity,
    isPlaying: state.players.some((item) => item.identity === room.localParticipant.identity),
    isMyTurn: state.currentPlayerIdentity === room.localParticipant.identity,
    isPendingDefense: state.pendingDefenseIdentity === room.localParticipant.identity,
    isPendingFavor: state.pendingFavor?.toIdentity === room.localParticipant.identity,
    participantCount: identitiesInRoom(room).length,
    start, reset, draw, play, defuse, favor, nope, choose, cardTitle,
  }
}
