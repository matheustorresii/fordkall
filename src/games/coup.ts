/** Coup classic, 2–6 players. Only state is public; deck and hands stay at the dealer. */
export const COUP_ROLES = ['duke', 'assassin', 'captain', 'ambassador', 'contessa'] as const
export type CoupRole = (typeof COUP_ROLES)[number]
export const COUP_ACTIONS = [
  'income',
  'foreign-aid',
  'tax',
  'assassinate',
  'steal',
  'exchange',
  'coup',
] as const
export type CoupAction = (typeof COUP_ACTIONS)[number]
export const coupRoles: Record<
  CoupRole,
  { name: string; power: string; block: string; color: string; symbol: string }
> = {
  duke: {
    name: 'Duque Kiwi',
    power: 'Receba 3 moedas',
    block: 'Bloqueia ajuda externa',
    color: '#c2a0ed',
    symbol: '♛',
  },
  assassin: {
    name: 'Assassino Kiwi',
    power: 'Pague 3 e retire uma influência',
    block: 'Pode ser bloqueado pela Condessa',
    color: '#ef9a99',
    symbol: '†',
  },
  captain: {
    name: 'Capitão Kiwi',
    power: 'Roube até 2 moedas',
    block: 'Bloqueia roubo',
    color: '#8dbce8',
    symbol: '⚓',
  },
  ambassador: {
    name: 'Embaixador Kiwi',
    power: 'Compre 2 e escolha o que manter',
    block: 'Bloqueia roubo',
    color: '#8bd4bb',
    symbol: '✉',
  },
  contessa: {
    name: 'Condessa Kiwi',
    power: 'Proteja sua influência',
    block: 'Bloqueia assassinato',
    color: '#edaccb',
    symbol: '❦',
  },
}
export const coupActions: Record<
  CoupAction,
  { name: string; detail: string; role: CoupRole | null; cost: number; targeted: boolean; symbol: string }
> = {
  income: {
    name: 'Renda',
    detail: '+1 moeda · sem contestação',
    role: null,
    cost: 0,
    targeted: false,
    symbol: '+1',
  },
  'foreign-aid': {
    name: 'Ajuda externa',
    detail: '+2 moedas · Duque pode bloquear',
    role: null,
    cost: 0,
    targeted: false,
    symbol: '+2',
  },
  tax: {
    name: 'Taxar',
    detail: '+3 moedas · alegue Duque',
    role: 'duke',
    cost: 0,
    targeted: false,
    symbol: '♛',
  },
  assassinate: {
    name: 'Assassinar',
    detail: '−3 moedas · retire 1 influência',
    role: 'assassin',
    cost: 3,
    targeted: true,
    symbol: '†',
  },
  steal: {
    name: 'Roubar',
    detail: 'Pegue até 2 moedas de alguém',
    role: 'captain',
    cost: 0,
    targeted: true,
    symbol: '⚓',
  },
  exchange: {
    name: 'Trocar cartas',
    detail: 'Compre 2 · mantenha suas influências',
    role: 'ambassador',
    cost: 0,
    targeted: false,
    symbol: '⇄',
  },
  coup: {
    name: 'Golpe',
    detail: '−7 moedas · não pode ser bloqueado',
    role: null,
    cost: 7,
    targeted: true,
    symbol: '✦',
  },
}
export interface CoupCard {
  id: string
  role: CoupRole
}
export interface CoupPlayer {
  identity: string
  name: string
  coins: number
  influence: number
  revealed: CoupCard[]
  away: boolean
}
export type CoupPhase =
  | 'lobby'
  | 'turn'
  | 'action-response'
  | 'block-response'
  | 'block-challenge'
  | 'proof'
  | 'lose-influence'
  | 'exchange'
  | 'finished'
export interface CoupSettings {
  responseSeconds: number
}
export const defaultCoupSettings: CoupSettings = { responseSeconds: 20 }
export type CoupContinuation = 'finish' | 'cancel' | 'offer-block' | 'resolve' | 'blocked'
export interface CoupPending {
  actor: string
  action: CoupAction
  target: string
  blocker: string
  blockRole: CoupRole | null
  challenger: string
  claim: 'action' | 'block'
  passes: string[]
  effectApplied: boolean
}
export interface CoupLoss {
  identity: string
  reason: 'challenge' | 'coup' | 'assassination'
  then: CoupContinuation
}
export interface CoupEvent {
  id: number
  kind: 'action' | 'block' | 'challenge' | 'proof' | 'loss' | 'exchange' | 'win' | 'leave'
  actor: string
  target: string
  role: CoupRole | null
  action: CoupAction | null
  text: string
}
export interface CoupState {
  gameId: string
  controllerIdentity: string
  revision: number
  phase: CoupPhase
  players: CoupPlayer[]
  current: string
  turn: number
  stepId: string
  expiresAt: number
  settings: CoupSettings
  treasury: number
  deckCount: number
  pending: CoupPending | null
  loss: CoupLoss | null
  winner: string
  events: CoupEvent[]
}
export interface CoupPrivate {
  hand: CoupCard[]
  exchange: CoupCard[]
}
export interface CoupEngine {
  state: CoupState
  deck: CoupCard[]
  hands: Record<string, CoupCard[]>
  exchange: CoupCard[]
}
export type CoupMove =
  | { type: 'act'; action: CoupAction; target?: string }
  | { type: 'pass' | 'challenge' | 'concede' }
  | { type: 'block'; role: CoupRole }
  | { type: 'prove' | 'lose'; cardId: string }
  | { type: 'exchange'; keep: string[] }
export interface CoupOptions {
  now?: number
  random?: () => number
  starter?: string
}
const random = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 0x100000000
const shuffle = <T>(items: T[], rng: () => number) => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[items[i], items[j]] = [items[j]!, items[i]!]
  }
  return items
}
export const readCoupSettings = (value: unknown): CoupSettings | null => {
  if (value === undefined) return { ...defaultCoupSettings }
  if (!value || typeof value !== 'object') return null
  const seconds = (value as CoupSettings).responseSeconds
  return [0, 15, 20, 30, 45].includes(seconds) ? { responseSeconds: seconds } : null
}
export const emptyCoupState = (controllerIdentity: string, revision = 0): CoupState => ({
  gameId: '',
  controllerIdentity,
  revision,
  phase: 'lobby',
  players: [],
  current: '',
  turn: 0,
  stepId: '',
  expiresAt: 0,
  settings: { ...defaultCoupSettings },
  treasury: 50,
  deckCount: 15,
  pending: null,
  loss: null,
  winner: '',
  events: [],
})
const alive = (state: CoupState) => state.players.filter((p) => p.influence > 0 && !p.away)
const player = (engine: CoupEngine, identity: string) => {
  const p = engine.state.players.find((p) => p.identity === identity)
  if (!p) throw new Error('Você está assistindo a esta partida.')
  return p
}
const event = (
  engine: CoupEngine,
  kind: CoupEvent['kind'],
  actor: string,
  text: string,
  extra: Partial<Pick<CoupEvent, 'target' | 'role' | 'action'>> = {},
) => {
  const events = engine.state.events
  events.push({
    id: (events.at(-1)?.id ?? 0) + 1,
    kind,
    actor,
    target: '',
    role: null,
    action: null,
    text,
    ...extra,
  })
  engine.state.events = events.slice(-24)
}
const enter = (engine: CoupEngine, phase: CoupPhase, now: number) => {
  const state = engine.state
  state.phase = phase
  state.stepId = crypto.randomUUID()
  // No automatic move on your turn. Personal card decisions get at least 45s.
  const seconds =
    phase === 'turn' || phase === 'finished' || !state.settings.responseSeconds
      ? 0
      : ['proof', 'lose-influence', 'exchange'].includes(phase)
        ? Math.max(45, state.settings.responseSeconds)
        : state.settings.responseSeconds
  state.expiresAt = seconds ? now + seconds * 1000 : 0
  state.deckCount = engine.deck.length
  if (state.pending) state.pending.passes = []
}
const pay = (engine: CoupEngine, identity: string, amount: number) => {
  const p = player(engine, identity)
  if (p.coins < amount) throw new Error('Você não tem moedas suficientes para essa ação.')
  p.coins -= amount
  engine.state.treasury += amount
}
const earn = (engine: CoupEngine, identity: string, amount: number) => {
  const taken = Math.min(amount, engine.state.treasury)
  player(engine, identity).coins += taken
  engine.state.treasury -= taken
}
const releaseCoins = (engine: CoupEngine, identity: string) => {
  const p = player(engine, identity)
  engine.state.treasury += p.coins
  p.coins = 0
}
const win = (engine: CoupEngine, now: number): boolean => {
  const remaining = alive(engine.state)
  if (remaining.length > 1) return false
  engine.state.winner = remaining[0]?.identity ?? ''
  engine.state.current = ''
  engine.state.pending = null
  engine.state.loss = null
  if (engine.exchange.length) {
    engine.deck.push(...engine.exchange)
    engine.exchange = []
  }
  enter(engine, 'finished', now)
  event(
    engine,
    'win',
    remaining[0]?.identity ?? '',
    remaining[0] ? `${remaining[0].name} conquistou a corte.` : 'A mesa foi encerrada.',
  )
  return true
}
const finish = (engine: CoupEngine, now: number) => {
  const state = engine.state
  if (win(engine, now)) return
  const origin = state.players.findIndex((p) => p.identity === state.current)
  for (let offset = 1; offset <= state.players.length; offset++) {
    const p = state.players[(origin + offset) % state.players.length]!
    if (p.influence && !p.away) {
      state.current = p.identity
      break
    }
  }
  state.turn++
  state.pending = null
  state.loss = null
  enter(engine, 'turn', now)
}
export const coupBlockRoles = (action: CoupAction): CoupRole[] =>
  action === 'foreign-aid'
    ? ['duke']
    : action === 'steal'
      ? ['captain', 'ambassador']
      : action === 'assassinate'
        ? ['contessa']
        : []
export const coupResponders = (state: CoupState): string[] => {
  const p = state.pending
  if (!p) return []
  const candidates = alive(state).map((p) => p.identity)
  if (state.phase === 'action-response')
    return candidates.filter((id) => id !== p.actor && !p.passes.includes(id))
  if (state.phase === 'block-challenge')
    return candidates.filter((id) => id !== p.blocker && !p.passes.includes(id))
  if (state.phase === 'block-response')
    return candidates.filter(
      (id) => id !== p.actor && (p.action === 'foreign-aid' || id === p.target) && !p.passes.includes(id),
    )
  return []
}
const lose = (
  engine: CoupEngine,
  identity: string,
  reason: CoupLoss['reason'],
  then: CoupContinuation,
  now: number,
) => {
  if (!player(engine, identity).influence) {
    resume(engine, then, now)
    return
  }
  engine.state.loss = { identity, reason, then }
  enter(engine, 'lose-influence', now)
}
const resolve = (engine: CoupEngine, now: number) => {
  const p = engine.state.pending
  if (!p || !player(engine, p.actor).influence) {
    finish(engine, now)
    return
  }
  if (p.action === 'income') earn(engine, p.actor, 1)
  if (p.action === 'foreign-aid') earn(engine, p.actor, 2)
  if (p.action === 'tax') earn(engine, p.actor, 3)
  if (p.action === 'steal' && !p.effectApplied) {
    const source = player(engine, p.target),
      amount = Math.min(2, source.coins)
    source.coins -= amount
    player(engine, p.actor).coins += amount
  }
  if (p.action === 'assassinate' || p.action === 'coup') {
    lose(engine, p.target, p.action === 'coup' ? 'coup' : 'assassination', 'finish', now)
    return
  }
  if (p.action === 'exchange') {
    engine.exchange = engine.deck.splice(0, 2)
    if (engine.exchange.length !== 2) throw new Error('A corte não tem cartas suficientes.')
    enter(engine, 'exchange', now)
    return
  }
  finish(engine, now)
}
const offerBlock = (engine: CoupEngine, now: number) => {
  const p = engine.state.pending!
  if (!coupBlockRoles(p.action).length) {
    resolve(engine, now)
    return
  }
  enter(engine, 'block-response', now)
  if (!coupResponders(engine.state).length) resolve(engine, now)
}
function resume(engine: CoupEngine, then: CoupContinuation, now: number) {
  engine.state.loss = null
  if (win(engine, now)) return
  if (then === 'offer-block') offerBlock(engine, now)
  else if (then === 'resolve') {
    if (engine.state.pending) {
      engine.state.pending.claim = 'action'
      engine.state.pending.blocker = ''
      engine.state.pending.blockRole = null
      engine.state.pending.challenger = ''
    }
    resolve(engine, now)
  } else finish(engine, now)
}
export const createCoupMatch = (
  members: Array<{ identity: string; name: string }>,
  settings: CoupSettings = defaultCoupSettings,
  options: CoupOptions = {},
): CoupEngine => {
  const chosen = readCoupSettings(settings)
  if (
    !chosen ||
    members.length < 2 ||
    members.length > 6 ||
    new Set(members.map((m) => m.identity)).size !== members.length ||
    members.some(
      (m) =>
        !m.identity ||
        m.identity.length > 128 ||
        ['__proto__', 'constructor', 'prototype'].includes(m.identity) ||
        !m.name ||
        m.name.length > 80,
    ) ||
    (options.starter !== undefined && !members.some((m) => m.identity === options.starter))
  )
    throw new Error('O Coup precisa de 2 a 6 pessoas e configurações válidas.')
  const rng = options.random ?? random
  const deck = shuffle(
    COUP_ROLES.flatMap((role) => Array.from({ length: 3 }, () => ({ id: crypto.randomUUID(), role }))),
    rng,
  )
  const engine: CoupEngine = { state: emptyCoupState(members[0]!.identity), deck, hands: {}, exchange: [] }
  engine.state.gameId = crypto.randomUUID()
  engine.state.settings = chosen
  // A rematch starts with the previous winner; a brand-new table chooses randomly.
  const starter = options.starter ?? members[Math.floor(rng() * members.length)]!.identity
  engine.state.players = members.map((m) => {
    engine.hands[m.identity] = deck.splice(0, 2)
    return {
      ...m,
      coins: members.length === 2 && m.identity === starter ? 1 : 2,
      influence: 2,
      revealed: [],
      away: false,
    }
  })
  engine.state.treasury = 50 - engine.state.players.reduce((sum, p) => sum + p.coins, 0)
  engine.state.current = starter
  engine.state.turn = 1
  enter(engine, 'turn', options.now ?? Date.now())
  return engine
}
export const coupPrivateFor = (engine: CoupEngine, identity: string): CoupPrivate => ({
  hand: (engine.hands[identity] ?? []).map((c) => ({ ...c })),
  exchange:
    engine.state.phase === 'exchange' && engine.state.pending?.actor === identity
      ? engine.exchange.map((c) => ({ ...c }))
      : [],
})
export const applyCoupMove = (
  previous: CoupEngine,
  identity: string,
  move: CoupMove,
  options: CoupOptions = {},
): CoupEngine => {
  const engine: CoupEngine = structuredClone(previous),
    state = engine.state
  const now = options.now ?? Date.now(),
    rng = options.random ?? random
  const who = player(engine, identity)
  if (!who.influence || who.away || ['lobby', 'finished'].includes(state.phase))
    throw new Error('Você está assistindo a esta partida.')
  if (move.type === 'act') {
    if (state.phase !== 'turn' || state.current !== identity) throw new Error('Espere a sua vez de jogar.')
    if (!COUP_ACTIONS.includes(move.action)) throw new Error('Ação inválida.')
    const action = coupActions[move.action]
    if (who.coins >= 10 && move.action !== 'coup')
      throw new Error('Com 10 moedas ou mais, você precisa dar um golpe.')
    const target = move.target ?? ''
    if (action.targeted && (!alive(state).some((p) => p.identity === target) || target === identity))
      throw new Error('Escolha outra pessoa ainda na partida.')
    if (!action.targeted && target) throw new Error('Essa ação não precisa de um alvo.')
    pay(engine, identity, action.cost)
    state.pending = {
      actor: identity,
      action: move.action,
      target,
      blocker: '',
      blockRole: null,
      challenger: '',
      claim: 'action',
      passes: [],
      effectApplied: false,
    }
    const description = action.role
      ? `alega ${coupRoles[action.role].name} para ${action.name.toLowerCase()}`
      : move.action === 'income'
        ? 'recebe renda'
        : move.action === 'foreign-aid'
          ? 'pede ajuda externa'
          : 'dá um golpe'
    event(
      engine,
      'action',
      identity,
      `${who.name} ${description}${target ? ` contra ${player(engine, target).name}` : ''}.`,
      { action: move.action, role: action.role, target },
    )
    if (move.action === 'income' || move.action === 'coup') resolve(engine, now)
    else if (action.role) enter(engine, 'action-response', now)
    else offerBlock(engine, now)
  } else if (move.type === 'pass') {
    if (!coupResponders(state).includes(identity))
      throw new Error('Você já respondeu ou esta decisão não é sua.')
    state.pending!.passes.push(identity)
    if (!coupResponders(state).length) {
      if (state.phase === 'action-response') offerBlock(engine, now)
      else if (state.phase === 'block-response') resolve(engine, now)
      else finish(engine, now)
    }
  } else if (move.type === 'challenge') {
    if (
      !['action-response', 'block-challenge'].includes(state.phase) ||
      !coupResponders(state).includes(identity)
    )
      throw new Error('Essa alegação não pode mais ser contestada.')
    const p = state.pending!
    p.claim = state.phase === 'block-challenge' ? 'block' : 'action'
    p.challenger = identity
    const claimant = p.claim === 'block' ? p.blocker : p.actor
    event(engine, 'challenge', identity, `${who.name} contesta ${player(engine, claimant).name}.`, {
      target: claimant,
    })
    enter(engine, 'proof', now)
  } else if (move.type === 'block') {
    if (
      state.phase !== 'block-response' ||
      !coupResponders(state).includes(identity) ||
      !coupBlockRoles(state.pending!.action).includes(move.role)
    )
      throw new Error('Esse bloqueio não é permitido.')
    const p = state.pending!
    p.blocker = identity
    p.blockRole = move.role
    p.claim = 'block'
    p.challenger = ''
    event(engine, 'block', identity, `${who.name} bloqueia com ${coupRoles[move.role].name}.`, {
      role: move.role,
      target: p.actor,
    })
    enter(engine, 'block-challenge', now)
  } else if (move.type === 'prove' || move.type === 'concede') {
    const p = state.pending!
    if (state.phase !== 'proof' || (p.claim === 'block' ? p.blocker : p.actor) !== identity)
      throw new Error('Essa contestação não é sua.')
    const role = p.claim === 'block' ? p.blockRole! : coupActions[p.action].role!
    if (move.type === 'prove') {
      const hand = engine.hands[identity]!,
        index = hand.findIndex((c) => c.id === move.cardId && c.role === role)
      if (index < 0) throw new Error('Escolha uma influência ativa do personagem alegado.')
      engine.deck.push(hand[index]!)
      shuffle(engine.deck, rng)
      hand[index] = engine.deck.shift()!
      event(
        engine,
        'proof',
        identity,
        `${who.name} provou ${coupRoles[role].name} e recebeu uma nova influência.`,
        { role, target: p.challenger },
      )
      lose(engine, p.challenger, 'challenge', p.claim === 'block' ? 'blocked' : 'offer-block', now)
    } else {
      // A successfully challenged action is cancelled and its cost refunded (base rulebook p. 5).
      if (p.claim === 'action' && coupActions[p.action].cost)
        earn(engine, p.actor, coupActions[p.action].cost)
      event(engine, 'proof', identity, `${who.name} não comprovou ${coupRoles[role].name}.`, {
        role,
        target: p.challenger,
      })
      lose(engine, identity, 'challenge', p.claim === 'block' ? 'resolve' : 'cancel', now)
    }
  } else if (move.type === 'lose') {
    const loss = state.loss
    if (state.phase !== 'lose-influence' || !loss || loss.identity !== identity)
      throw new Error('Você não precisa revelar uma influência agora.')
    const hand = engine.hands[identity]!,
      index = hand.findIndex((c) => c.id === move.cardId)
    if (index < 0) throw new Error('Escolha uma das suas influências ativas.')
    const [card] = hand.splice(index, 1)
    who.revealed.push(card!)
    who.influence = hand.length
    event(
      engine,
      'loss',
      identity,
      `${who.name} revelou ${coupRoles[card!.role].name}${hand.length ? '.' : ' e está fora da corte.'}`,
      { role: card!.role },
    )
    // The rulebook's steal example awards the coins before an exposed blocker's exile.
    const p = state.pending
    if (!hand.length && loss.then === 'resolve' && p?.action === 'steal' && p.target === identity) {
      const amount = Math.min(2, who.coins)
      who.coins -= amount
      player(engine, p.actor).coins += amount
      p.effectApplied = true
    }
    if (!hand.length) releaseCoins(engine, identity)
    resume(engine, loss.then, now)
  } else if (move.type === 'exchange') {
    if (state.phase !== 'exchange' || state.pending?.actor !== identity)
      throw new Error('Essa troca não é sua.')
    const pool = [...engine.hands[identity]!, ...engine.exchange]
    if (
      move.keep.length !== who.influence ||
      new Set(move.keep).size !== move.keep.length ||
      move.keep.some((id) => !pool.some((c) => c.id === id))
    )
      throw new Error(`Escolha exatamente ${who.influence} influência(s) para manter.`)
    engine.hands[identity] = pool.filter((c) => move.keep.includes(c.id))
    engine.deck.push(...pool.filter((c) => !move.keep.includes(c.id)))
    shuffle(engine.deck, rng)
    engine.exchange = []
    event(engine, 'exchange', identity, `${who.name} concluiu a troca em segredo.`)
    finish(engine, now)
  } else throw new Error('Ação inválida.')
  state.deckCount = engine.deck.length
  return engine
}
/** Only the controller calls this. Timed out reactions accept, never invent a bluff. */
export const expireCoupDecision = (previous: CoupEngine, options: CoupOptions = {}): CoupEngine => {
  const state = previous.state,
    now = options.now ?? Date.now()
  if (!state.expiresAt || now < state.expiresAt) throw new Error('A decisão ainda tem tempo.')
  const responders = coupResponders(state)
  if (responders.length) {
    let result = previous
    for (const id of responders) {
      if (result.state.stepId !== state.stepId) break
      result = applyCoupMove(result, id, { type: 'pass' }, options)
    }
    return result
  }
  if (state.phase === 'proof') {
    const p = state.pending!,
      id = p.claim === 'block' ? p.blocker : p.actor
    const role = p.claim === 'block' ? p.blockRole : coupActions[p.action].role
    const proof = previous.hands[id]?.find((c) => c.role === role)
    return applyCoupMove(
      previous,
      id,
      proof ? { type: 'prove', cardId: proof.id } : { type: 'concede' },
      options,
    )
  }
  if (state.phase === 'lose-influence') {
    const id = state.loss!.identity
    return applyCoupMove(previous, id, { type: 'lose', cardId: previous.hands[id]![0]!.id }, options)
  }
  if (state.phase === 'exchange') {
    const id = state.pending!.actor
    return applyCoupMove(
      previous,
      id,
      { type: 'exchange', keep: previous.hands[id]!.map((c) => c.id) },
      options,
    )
  }
  throw new Error('Não há decisão pendente.')
}
/** Leaving a room forfeits influence. Returning or newly joining people may spectate. */
export const syncCoupMembers = (
  previous: CoupEngine,
  connected: Set<string>,
  options: CoupOptions = {},
): CoupEngine => {
  const engine: CoupEngine = structuredClone(previous),
    state = engine.state,
    now = options.now ?? Date.now()
  if (['lobby', 'finished'].includes(state.phase)) return engine
  const departed = state.players.filter((p) => !connected.has(p.identity) && !p.away)
  if (!departed.length) return engine
  for (const p of departed) {
    p.away = true
    p.influence = 0
    p.revealed.push(...(engine.hands[p.identity] ?? []))
    engine.hands[p.identity] = []
    releaseCoins(engine, p.identity)
    event(engine, 'leave', p.identity, `${p.name} saiu da mesa.`)
  }
  if (win(engine, now)) return engine
  const p = state.pending
  if (!player(engine, state.current).influence) {
    if (engine.exchange.length) {
      engine.deck.push(...engine.exchange)
      engine.exchange = []
    }
    finish(engine, now)
  } else if (state.phase === 'lose-influence' && state.loss && !player(engine, state.loss.identity).influence)
    resume(engine, state.loss.then, now)
  else if (
    state.phase === 'proof' &&
    p &&
    !player(engine, p.claim === 'block' ? p.blocker : p.actor).influence
  )
    resume(engine, p.claim === 'block' ? 'resolve' : 'cancel', now)
  else if (state.phase === 'block-challenge' && p && !player(engine, p.blocker).influence)
    resolve(engine, now)
  else if (
    ['action-response', 'block-response', 'block-challenge'].includes(state.phase) &&
    !coupResponders(state).length
  ) {
    if (state.phase === 'action-response') offerBlock(engine, now)
    else if (state.phase === 'block-response') resolve(engine, now)
    else finish(engine, now)
  }
  state.deckCount = engine.deck.length
  return engine
}
