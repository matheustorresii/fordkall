/** ODIN base rules (Helvetiq): 9 cards, climbing combinations and one captured card. Original Kiwi visuals live in the UI. */
export const ODIN_CLANS = [
  'leaf',
  'tide',
  'sun',
  'ember',
  'moon',
  'bloom',
] as const
export type OdinClan = (typeof ODIN_CLANS)[number]
export interface OdinCard {
  id: string
  clan: OdinClan
  value: number
}
export const odinClans: Record<
  OdinClan,
  { name: string; color: string; ink: string; symbol: string }
> = {
  leaf: { name: 'Folha', color: '#a9cc8f', ink: '#243e30', symbol: '♧' },
  tide: { name: 'Maré', color: '#8fbfd9', ink: '#203d55', symbol: '≈' },
  sun: { name: 'Sol', color: '#e3c67c', ink: '#57421c', symbol: '☀' },
  ember: { name: 'Brasa', color: '#dd9a85', ink: '#5f3028', symbol: '◆' },
  moon: { name: 'Lua', color: '#b3a4d8', ink: '#3d315b', symbol: '☾' },
  bloom: { name: 'Flor', color: '#d9a6c1', ink: '#553149', symbol: '✿' },
}
export interface OdinSettings {
  pointLimit: 10 | 15 | 20
  singleHand: boolean
  duelFourClans: boolean
  turnSeconds: 0 | 30 | 60 | 90
}
export const defaultOdinSettings: OdinSettings = {
  pointLimit: 15,
  singleHand: false,
  duelFourClans: true,
  turnSeconds: 0,
}
export function readOdinSettings(value: unknown): OdinSettings | null {
  if (!value || typeof value !== 'object') return null
  const v = value as OdinSettings
  return [10, 15, 20].includes(v.pointLimit) &&
    typeof v.singleHand === 'boolean' &&
    typeof v.duelFourClans === 'boolean' &&
    [0, 30, 60, 90].includes(v.turnSeconds)
    ? {
        pointLimit: v.pointLimit,
        singleHand: v.singleHand,
        duelFourClans: v.duelFourClans,
        turnSeconds: v.turnSeconds,
      }
    : null
}
export interface OdinPlayer {
  identity: string
  name: string
  cardsRemaining: number
  score: number
  away: boolean
}
export interface OdinPlay {
  id: string
  actor: string
  cards: OdinCard[]
  taken: OdinCard | null
  value: number
}
export interface OdinResult {
  winner: string
  entries: Array<{ identity: string; penalty: number; total: number }>
}
export interface OdinState {
  gameId: string
  controllerIdentity: string
  revision: number
  phase: 'lobby' | 'playing' | 'hand-result' | 'finished'
  settings: OdinSettings
  players: OdinPlayer[]
  current: string
  starter: string
  handNumber: number
  roundNumber: number
  stepId: string
  turnExpiresAt: number
  transitionAt: number
  center: OdinCard[]
  lastPlayer: string
  passes: string[]
  discardedCount: number
  asideCount: number
  deckSize: number
  lastPlay: OdinPlay | null
  result: OdinResult | null
  winners: string[]
  finishReason: '' | 'points' | 'single-hand' | 'not-enough-players'
  lastEvent: string
}
export interface OdinPrivate {
  hand: OdinCard[]
}
export interface OdinEngine {
  state: OdinState
  hands: Record<string, OdinCard[]>
  discarded: OdinCard[]
  aside: OdinCard[]
}
export type OdinMove =
  | { type: 'pass' }
  | { type: 'play'; cardIds: string[]; takeId?: string }
interface Runtime {
  now?: number
  random?: () => number
  id?: () => string
}
const uuid = (r: Runtime) => r.id?.() || crypto.randomUUID()
const now = (r: Runtime) => r.now ?? Date.now()
const safeIdentity = (value: string) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 128 &&
  !/[\u0000-\u001f\u007f]/.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value)
export const odinDeck = (fourClans = false): OdinCard[] =>
  ODIN_CLANS.slice(0, fourClans ? 4 : 6).flatMap((clan) =>
    Array.from({ length: 9 }, (_, i) => ({
      id: `${clan}-${i + 1}`,
      clan,
      value: i + 1,
    })),
  )
export const odinValue = (cards: readonly OdinCard[]) =>
  cards.length
    ? Number(
        [...cards]
          .map((c) => c.value)
          .sort((a, b) => b - a)
          .join(''),
      )
    : 0
export const odinSameGroup = (cards: readonly OdinCard[]) =>
  cards.length > 0 &&
  (cards.every((c) => c.clan === cards[0]!.clan) ||
    cards.every((c) => c.value === cards[0]!.value))
export function odinPlayError(
  hand: readonly OdinCard[],
  center: readonly OdinCard[],
  cardIds: readonly string[],
): string | null {
  if (
    !cardIds.length ||
    cardIds.length > 9 ||
    new Set(cardIds).size !== cardIds.length
  )
    return 'Escolha cartas diferentes da sua mão.'
  const cards = cardIds.map((id) => hand.find((c) => c.id === id))
  if (cards.some((c) => !c)) return 'Uma dessas cartas não está na sua mão.'
  const selected = cards as OdinCard[]
  if (!odinSameGroup(selected))
    return 'Combine cartas da mesma cor ou do mesmo número.'
  if (!center.length)
    return selected.length === 1 || selected.length === hand.length
      ? null
      : 'Para abrir, jogue uma carta. Só pode jogar várias se forem todas as da sua mão.'
  if (
    selected.length !== center.length &&
    selected.length !== center.length + 1
  )
    return `Jogue ${center.length} ou ${center.length + 1} cartas.`
  return odinValue(selected) > odinValue(center)
    ? null
    : 'Sua combinação precisa ser maior que a da mesa.'
}
export function odinLegalPlays(
  hand: readonly OdinCard[],
  center: readonly OdinCard[],
): string[][] {
  if (hand.length > 9) return []
  const result: string[][] = []
  for (let bits = 1; bits < 1 << hand.length; bits++) {
    const ids = hand.filter((_, index) => bits & (1 << index)).map((c) => c.id)
    if (!odinPlayError(hand, center, ids)) result.push(ids)
  }
  return result
}
export const emptyOdinState = (
  controllerIdentity: string,
  revision = 0,
): OdinState => ({
  gameId: '',
  controllerIdentity,
  revision,
  phase: 'lobby',
  settings: { ...defaultOdinSettings },
  players: [],
  current: '',
  starter: '',
  handNumber: 0,
  roundNumber: 0,
  stepId: '',
  turnExpiresAt: 0,
  transitionAt: 0,
  center: [],
  lastPlayer: '',
  passes: [],
  discardedCount: 0,
  asideCount: 0,
  deckSize: 54,
  lastPlay: null,
  result: null,
  winners: [],
  finishReason: '',
  lastEvent: '',
})
const turn = (state: OdinState, identity: string, r: Runtime) => {
  state.current = identity
  state.stepId = uuid(r)
  state.turnExpiresAt = state.settings.turnSeconds
    ? now(r) + state.settings.turnSeconds * 1000
    : 0
}
const next = (state: OdinState, identity: string) => {
  const at = state.players.findIndex((p) => p.identity === identity)
  for (let n = 1; n <= state.players.length; n++) {
    const p =
      state.players[(at + n + state.players.length) % state.players.length]!
    if (!p.away) return p.identity
  }
  return ''
}
const counts = (engine: OdinEngine) => {
  engine.state.players.forEach((p) => {
    p.cardsRemaining = engine.hands[p.identity]?.length || 0
  })
  engine.state.discardedCount = engine.discarded.length
  engine.state.asideCount = engine.aside.length
}
function deal(engine: OdinEngine, r: Runtime) {
  const s = engine.state
  const deck = odinDeck(s.players.length === 2 && s.settings.duelFourClans)
  const random =
    r.random ||
    (() => crypto.getRandomValues(new Uint32Array(1))[0]! / 0x100000000)
  for (let i = deck.length - 1; i > 0; i--) {
    const at = Math.floor(random() * (i + 1))
    if (!Number.isInteger(at) || at < 0 || at > i)
      throw Error('Sorteio inválido.')
    ;[deck[i], deck[at]] = [deck[at]!, deck[i]!]
  }
  engine.hands = Object.fromEntries(s.players.map((p) => [p.identity, []]))
  for (let card = 0; card < 9; card++)
    for (const p of s.players.filter((p) => !p.away))
      engine.hands[p.identity]!.push(deck.pop()!)
  engine.aside = deck
  engine.discarded = []
  s.deckSize = s.players.length === 2 && s.settings.duelFourClans ? 36 : 54
  s.center = []
  s.passes = []
  s.lastPlayer = ''
  s.phase = 'playing'
  s.roundNumber = 1
  s.lastPlay = null
  s.result = null
  s.winners = []
  s.transitionAt = 0
  s.finishReason = ''
  s.lastEvent = `Mão ${s.handNumber}. ${s.players.find((p) => p.identity === s.starter)!.name} começa.`
  counts(engine)
  turn(s, s.starter, r)
  return engine
}
export function createOdinMatch(
  members: Array<{ identity: string; name: string }>,
  value: OdinSettings = defaultOdinSettings,
  r: Runtime = {},
): OdinEngine {
  const settings = readOdinSettings(value)
  if (!settings) throw Error('Configuração de ODIN inválida.')
  if (
    members.length < 2 ||
    members.length > 6 ||
    new Set(members.map((p) => p.identity)).size !== members.length ||
    members.some((p) => !safeIdentity(p.identity))
  )
    throw Error('ODIN aceita de 2 a 6 pessoas diferentes.')
  const random =
    r.random ||
    (() => crypto.getRandomValues(new Uint32Array(1))[0]! / 0x100000000)
  const starter = Math.floor(random() * members.length)
  if (!Number.isInteger(starter) || starter < 0 || starter >= members.length)
    throw Error('Sorteio inválido.')
  const state: OdinState = {
    ...emptyOdinState(members[0]!.identity),
    gameId: uuid(r),
    settings,
    handNumber: 1,
    starter: members[starter]!.identity,
    players: members.map((p) => ({
      identity: p.identity,
      name:
        p.name
          .replace(/[\u0000-\u001f\u007f]/g, '')
          .trim()
          .slice(0, 80) || 'Jogador',
      cardsRemaining: 9,
      score: 0,
      away: false,
    })),
  }
  return deal({ state, hands: {}, aside: [], discarded: [] }, r)
}
function finishHand(engine: OdinEngine, winner: string, r: Runtime) {
  const s = engine.state
  const entries = s.players
    .filter((p) => !p.away)
    .map((p) => {
      const penalty = engine.hands[p.identity]!.length
      p.score += penalty
      return { identity: p.identity, penalty, total: p.score }
    })
  s.result = { winner, entries }
  s.current = ''
  s.turnExpiresAt = 0
  s.stepId = uuid(r)
  const finished =
    s.settings.singleHand ||
    entries.some((p) => p.total >= s.settings.pointLimit)
  s.phase = finished ? 'finished' : 'hand-result'
  s.transitionAt = finished ? 0 : now(r) + 8000
  if (finished) {
    const low = Math.min(...entries.map((p) => p.total))
    s.winners = entries.filter((p) => p.total === low).map((p) => p.identity)
    s.finishReason = s.settings.singleHand ? 'single-hand' : 'points'
  }
  s.lastEvent = `${s.players.find((p) => p.identity === winner)!.name} esvaziou a mão.`
  counts(engine)
  return engine
}
export function applyOdinMove(
  previous: OdinEngine,
  identity: string,
  move: OdinMove,
  r: Runtime = {},
): OdinEngine {
  const s = previous.state
  if (
    s.phase !== 'playing' ||
    s.current !== identity ||
    !s.players.some((p) => p.identity === identity && !p.away)
  )
    throw Error('Aguarde sua vez de jogar.')
  const engine: OdinEngine = structuredClone(previous),
    state = engine.state,
    hand = engine.hands[identity]!
  const name = state.players.find((p) => p.identity === identity)!.name
  if (move.type === 'pass') {
    if (!state.center.length) throw Error('Quem abre a disputa precisa jogar.')
    state.passes.push(identity)
    if (
      state.passes.length >=
      state.players.filter((p) => !p.away).length - 1
    ) {
      engine.discarded.push(...state.center)
      state.center = []
      state.passes = []
      state.roundNumber++
      const leader = state.lastPlayer
      state.lastPlayer = ''
      turn(state, leader, r)
      state.lastEvent = `${state.players.find((p) => p.identity === leader)!.name} abre uma nova disputa.`
    } else {
      turn(state, next(state, identity), r)
      state.lastEvent = `${name} passou.`
    }
    counts(engine)
    return engine
  }
  const invalid = odinPlayError(hand, state.center, move.cardIds)
  if (invalid) throw Error(invalid)
  const played = move.cardIds
    .map((id) => hand.find((c) => c.id === id)!)
    .sort((a, b) => b.value - a.value)
  const remaining = hand.filter((c) => !move.cardIds.includes(c.id))
  let taken: OdinCard | null = null
  if (state.center.length && remaining.length) {
    taken =
      state.center.length === 1
        ? state.center[0]!
        : state.center.find((c) => c.id === move.takeId) || null
    if (!taken || (move.takeId && taken.id !== move.takeId))
      throw Error('Escolha uma carta da jogada anterior para pegar.')
    remaining.push(taken)
  } else if (move.takeId) throw Error('Essa jogada não pega carta da mesa.')
  engine.hands[identity] = remaining
  engine.discarded.push(...state.center.filter((c) => c.id !== taken?.id))
  state.center = played
  state.lastPlayer = identity
  state.passes = []
  state.lastPlay = {
    id: uuid(r),
    actor: identity,
    cards: played,
    taken,
    value: odinValue(played),
  }
  state.lastEvent = `${name} jogou ${odinValue(played)}${taken ? ` e pegou ${taken.value} de ${odinClans[taken.clan].name}` : ''}.`
  if (!remaining.length) return finishHand(engine, identity, r)
  counts(engine)
  turn(state, next(state, identity), r)
  return engine
}
export function advanceOdinHand(
  previous: OdinEngine,
  r: Runtime = {},
): OdinEngine {
  if (previous.state.phase !== 'hand-result')
    throw Error('Esta mão ainda não terminou.')
  const engine = structuredClone(previous)
  engine.state.handNumber++
  engine.state.starter = next(engine.state, engine.state.starter)
  return deal(engine, r)
}
export function syncOdinMembers(
  previous: OdinEngine,
  connected: Set<string>,
  r: Runtime = {},
): OdinEngine {
  if (!previous.state.gameId || previous.state.phase === 'finished')
    return previous
  const departing = previous.state.players.filter(
    (p) => !p.away && !connected.has(p.identity),
  )
  if (!departing.length) return previous
  const engine = structuredClone(previous),
    s = engine.state
  for (const p of s.players)
    if (departing.some((gone) => gone.identity === p.identity)) {
      p.away = true
      engine.discarded.push(...engine.hands[p.identity]!)
      engine.hands[p.identity] = []
    }
  const available = s.players.filter((p) => !p.away)
  if (available.length < 2) {
    s.phase = 'finished'
    s.finishReason = 'not-enough-players'
    s.current = ''
    s.turnExpiresAt = 0
    s.transitionAt = 0
    s.winners = []
    s.stepId = uuid(r)
    s.lastEvent =
      'A mesa foi encerrada: são necessárias pelo menos duas pessoas.'
  } else if (s.phase === 'playing') {
    const leader = available.some((p) => p.identity === s.current)
      ? s.current
      : next(s, s.current)
    engine.discarded.push(...s.center)
    s.center = []
    s.lastPlayer = ''
    s.passes = []
    s.roundNumber++
    turn(s, leader, r)
    s.lastEvent = `${departing.map((p) => p.name).join(', ')} saiu da mesa. Uma nova disputa começa.`
  }
  counts(engine)
  return engine
}
export function expireOdinTurn(
  previous: OdinEngine,
  r: Runtime = {},
): OdinEngine {
  const s = previous.state
  if (!s.turnExpiresAt || now(r) < s.turnExpiresAt || s.phase !== 'playing')
    return previous
  if (s.center.length)
    return applyOdinMove(previous, s.current, { type: 'pass' }, r)
  const hand = previous.hands[s.current]!,
    cards = odinSameGroup(hand)
      ? hand
      : [...hand].sort((a, b) => a.value - b.value).slice(0, 1)
  return applyOdinMove(
    previous,
    s.current,
    { type: 'play', cardIds: cards.map((c) => c.id) },
    r,
  )
}
export const odinPrivateFor = (
  engine: OdinEngine,
  identity: string,
): OdinPrivate => ({ hand: engine.hands[identity] || [] })
