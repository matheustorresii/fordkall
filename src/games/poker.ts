export type PokerSuit = 's' | 'h' | 'd' | 'c'
export type PokerRank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A'
export type PokerCard = `${PokerRank}${PokerSuit}`
export type PokerStreet = 'preflop' | 'flop' | 'turn' | 'river'
export interface PokerSettings {
  startingStack: number
  bigBlind: number
  turnSeconds: number
}
export const defaultPokerSettings: PokerSettings = { startingStack: 1000, bigBlind: 10, turnSeconds: 60 }
export interface PokerPlayer {
  identity: string
  name: string
  stack: number
  bet: number
  committed: number
  inHand: boolean
  folded: boolean
  allIn: boolean
  away: boolean
  actedAt: number | null
  action: string
}
export interface PokerPot {
  amount: number
  eligible: string[]
  winners: string[]
}
export interface PokerResult {
  payouts: Record<string, number>
  refunds: Record<string, number>
  pots: PokerPot[]
  hands: Record<string, string>
  bestCards: Record<string, PokerCard[]>
  uncontested: boolean
}
export interface PokerEvent {
  id: number
  identity: string
  text: string
}
export interface PokerState {
  gameId: string
  matchId: string
  controllerIdentity: string
  revision: number
  phase: 'lobby' | 'playing' | 'hand-result' | 'finished'
  street: PokerStreet
  handNumber: number
  settings: PokerSettings
  players: PokerPlayer[]
  board: PokerCard[]
  dealer: string
  smallBlind: string
  bigBlind: string
  current: string
  currentBet: number
  lastFullRaise: number
  pending: string[]
  turnId: string
  turnExpiresAt: number
  revealed: Record<string, PokerCard[]>
  returned: Record<string, number>
  result: PokerResult | null
  events: PokerEvent[]
}
export interface PokerEngine {
  state: PokerState
  deck: PokerCard[]
  hands: Record<string, PokerCard[]>
}
export type PokerAction = { type: 'fold' | 'check' | 'call' | 'all-in' } | { type: 'raise'; total: number }
export interface PokerHand {
  score: number
  category: number
  name: string
  cards: PokerCard[]
}
const ranks = '23456789TJQKA'
const suits: PokerSuit[] = ['s', 'h', 'd', 'c']
const handNames = [
  'Carta alta',
  'Um par',
  'Dois pares',
  'Trinca',
  'Sequência',
  'Flush',
  'Full house',
  'Quadra',
  'Straight flush',
]
const integer = (value: unknown, min: number, max: number): value is number =>
  Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
export const isPokerCard = (value: unknown): value is PokerCard =>
  typeof value === 'string' && /^[2-9TJQKA][shdc]$/.test(value)
export const pokerRank = (card: PokerCard) => ranks.indexOf(card[0]!) + 2
export const readPokerSettings = (value: unknown): PokerSettings | null => {
  if (value === undefined) return { ...defaultPokerSettings }
  if (!value || typeof value !== 'object') return null
  const raw = value as PokerSettings
  return integer(raw.startingStack, 100, 100000) &&
    integer(raw.bigBlind, 2, 10000) &&
    raw.bigBlind % 2 === 0 &&
    raw.startingStack >= raw.bigBlind * 10 &&
    [0, 30, 60, 90].includes(raw.turnSeconds)
    ? { startingStack: raw.startingStack, bigBlind: raw.bigBlind, turnSeconds: raw.turnSeconds }
    : null
}
export const emptyPokerState = (controllerIdentity: string, revision = 0): PokerState => ({
  gameId: '',
  matchId: '',
  controllerIdentity,
  revision,
  phase: 'lobby',
  street: 'preflop',
  handNumber: 0,
  settings: { ...defaultPokerSettings },
  players: [],
  board: [],
  dealer: '',
  smallBlind: '',
  bigBlind: '',
  current: '',
  currentBet: 0,
  lastFullRaise: 10,
  pending: [],
  turnId: '',
  turnExpiresAt: 0,
  revealed: {},
  returned: {},
  result: null,
  events: [],
})

export const makePokerDeck = (random?: () => number): PokerCard[] => {
  const deck = [...ranks].flatMap((rank) => suits.map((suit) => `${rank}${suit}` as PokerCard))
  const index = (size: number) => {
    if (random) return Math.floor(random() * size)
    const limit = 0x100000000 - (0x100000000 % size),
      value = new Uint32Array(1)
    do {
      crypto.getRandomValues(value)
    } while (value[0]! >= limit)
    return value[0]! % size
  }
  for (let end = deck.length - 1; end > 0; end--) {
    const other = index(end + 1)
    ;[deck[end], deck[other]] = [deck[other]!, deck[end]!]
  }
  return deck
}

/** Comparable six-digit base-15 score. Suits never break ties. */
export const evaluatePokerFive = (cards: PokerCard[]): PokerHand => {
  if (cards.length !== 5 || cards.some((card) => !isPokerCard(card)) || new Set(cards).size !== 5)
    throw new Error('Uma mão precisa de cinco cartas diferentes.')
  const values = cards.map(pokerRank).sort((a, b) => b - a)
  const groups = [...new Set(values)]
    .map((value) => ({ value, count: values.filter((n) => n === value).length }))
    .sort((a, b) => b.count - a.count || b.value - a.value)
  const flush = cards.every((card) => card[1] === cards[0]![1])
  const unique = [...new Set(values)]
  const straight =
    unique.length === 5 ? (values[0]! - values[4]! === 4 ? values[0]! : values.join() === '14,5,4,3,2' ? 5 : 0) : 0
  let category = 0,
    kickers = values
  if (straight && flush) {
    category = 8
    kickers = [straight]
  } else if (groups[0]!.count === 4) {
    category = 7
    kickers = groups.map((g) => g.value)
  } else if (groups[0]!.count === 3 && groups[1]!.count === 2) {
    category = 6
    kickers = groups.map((g) => g.value)
  } else if (flush) category = 5
  else if (straight) {
    category = 4
    kickers = [straight]
  } else if (groups[0]!.count === 3) {
    category = 3
    kickers = groups.map((g) => g.value)
  } else if (groups[0]!.count === 2 && groups[1]!.count === 2) {
    category = 2
    kickers = groups.map((g) => g.value)
  } else if (groups[0]!.count === 2) {
    category = 1
    kickers = groups.map((g) => g.value)
  }
  const score = [category, ...Array.from({ length: 5 }, (_, index) => kickers[index] ?? 0)].reduce(
    (total, value) => total * 15 + value,
    0,
  )
  return {
    score,
    category,
    name: category === 8 && straight === 14 ? 'Royal flush' : handNames[category]!,
    cards: [...cards],
  }
}
export const evaluatePokerHand = (cards: PokerCard[]): PokerHand => {
  if (
    cards.length < 5 ||
    cards.length > 7 ||
    cards.some((card) => !isPokerCard(card)) ||
    new Set(cards).size !== cards.length
  )
    throw new Error('Use de cinco a sete cartas diferentes.')
  let best: PokerHand | undefined
  for (let a = 0; a < cards.length - 4; a++)
    for (let b = a + 1; b < cards.length - 3; b++)
      for (let c = b + 1; c < cards.length - 2; c++)
        for (let d = c + 1; d < cards.length - 1; d++)
          for (let e = d + 1; e < cards.length; e++) {
            const hand = evaluatePokerFive([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!])
            if (!best || hand.score > best.score) best = hand
          }
  return best!
}
const cloneEngine = (engine: PokerEngine): PokerEngine => ({
  state: {
    ...engine.state,
    settings: { ...engine.state.settings },
    players: engine.state.players.map((p) => ({ ...p })),
    board: [...engine.state.board],
    pending: [...engine.state.pending],
    events: [...engine.state.events],
    revealed: { ...engine.state.revealed },
    returned: { ...engine.state.returned },
  },
  deck: [...engine.deck],
  hands: engine.hands,
})
const event = (state: PokerState, identity: string, text: string) => {
  state.events = [...state.events, { id: (state.events.at(-1)?.id ?? 0) + 1, identity, text }].slice(-40)
}
const clockwise = (state: PokerState, after: string, predicate: (player: PokerPlayer) => boolean) => {
  const start = state.players.findIndex((p) => p.identity === after)
  return Array.from(
    { length: state.players.length },
    (_, offset) => state.players[(start + offset + 1 + state.players.length) % state.players.length]!,
  ).filter(predicate)
}
const live = (p: PokerPlayer) => p.inHand && !p.folded
const canAct = (p: PokerPlayer) => live(p) && p.stack > 0 && !p.away
const pay = (p: PokerPlayer, amount: number) => {
  const paid = Math.min(p.stack, amount)
  p.stack -= paid
  p.bet += paid
  p.committed += paid
  p.allIn = p.stack === 0
  return paid
}
const setTurn = (state: PokerState) => {
  const next = state.pending[0] ?? ''
  if (next && state.current === next && state.turnId) return
  state.current = next
  state.turnId = state.current ? crypto.randomUUID() : ''
  state.turnExpiresAt = state.current && state.settings.turnSeconds ? Date.now() + state.settings.turnSeconds * 1000 : 0
}
export const pokerPotTotal = (state: PokerState) => state.players.reduce((total, p) => total + p.committed, 0)
export const pokerLegalActions = (state: PokerState, identity: string) => {
  const player = state.players.find((p) => p.identity === identity)
  const active = state.phase === 'playing' && state.current === identity && Boolean(player && canAct(player))
  const toCall = player ? Math.max(0, state.currentBet - player.bet) : 0
  const maxTotal = player ? player.bet + player.stack : 0
  const reopened = Boolean(
    player && (player.actedAt === null || state.currentBet - player.actedAt >= state.lastFullRaise),
  )
  const raise =
    active && reopened && maxTotal > state.currentBet && state.players.some((p) => p.identity !== identity && canAct(p))
  return {
    active,
    toCall,
    callAmount: Math.min(toCall, player?.stack ?? 0),
    minRaise: state.currentBet + state.lastFullRaise,
    maxTotal,
    canCheck: active && toCall === 0,
    canRaise: raise,
    canAllIn: active && (maxTotal <= state.currentBet || raise),
  }
}
const returnUncalled = (state: PokerState): Record<string, number> => {
  const ordered = [...state.players].sort((a, b) => b.bet - a.bet),
    first = ordered[0],
    second = ordered[1]
  const amount = first ? first.bet - (second?.bet ?? 0) : 0
  if (!first || amount <= 0) return {}
  first.stack += amount
  first.bet -= amount
  first.committed -= amount
  first.allIn = first.stack === 0
  state.returned[first.identity] = (state.returned[first.identity] ?? 0) + amount
  return { [first.identity]: amount }
}
export const settlePokerPots = (
  players: PokerPlayer[],
  board: PokerCard[],
  hands: Record<string, PokerCard[]>,
  dealer: string,
) => {
  const levels = [...new Set(players.map((p) => p.committed).filter(Boolean))].sort((a, b) => a - b)
  const payouts: Record<string, number> = {},
    refunds: Record<string, number> = {},
    pots: PokerPot[] = [],
    ranked: Record<string, PokerHand> = {}
  for (const player of players.filter(live))
    ranked[player.identity] = evaluatePokerHand([...(hands[player.identity] ?? []), ...board])
  let previous = 0
  for (const level of levels) {
    const contributors = players.filter((p) => p.committed >= level)
    const layer = level - previous,
      amount = layer * contributors.length
    previous = level
    const eligible = contributors.filter(live).map((p) => p.identity)
    // Multiple departures can leave a side pot with no surviving contender.
    // Return that layer to its contributors instead of inventing an eligible winner.
    if (!eligible.length) {
      contributors.forEach((p) => {
        refunds[p.identity] = (refunds[p.identity] ?? 0) + layer
      })
      continue
    }
    const best = Math.max(...eligible.map((id) => ranked[id]!.score))
    const winners = eligible.filter((id) => ranked[id]!.score === best)
    if (!winners.length) throw new Error('Não há jogador elegível para um dos potes.')
    const state = { players } as PokerState
    const order = clockwise(state, dealer, (p) => winners.includes(p.identity)).map((p) => p.identity)
    const share = Math.floor(amount / winners.length),
      remainder = amount % winners.length
    order.forEach((id, index) => {
      payouts[id] = (payouts[id] ?? 0) + share + Number(index < remainder)
    })
    pots.push({ amount, eligible, winners })
  }
  return {
    payouts,
    refunds,
    pots,
    hands: Object.fromEntries(Object.entries(ranked).map(([id, hand]) => [id, hand.name])),
    bestCards: Object.fromEntries(Object.entries(ranked).map(([id, hand]) => [id, hand.cards])),
  }
}
const settle = (engine: PokerEngine, uncontested: boolean) => {
  const state = engine.state,
    survivors = state.players.filter(live)
  const refunds = { ...state.returned }
  if (uncontested) {
    const winner = survivors[0]!
    const amount = pokerPotTotal(state)
    state.result = {
      payouts: { [winner.identity]: amount },
      refunds,
      pots: [{ amount, eligible: [winner.identity], winners: [winner.identity] }],
      hands: {},
      bestCards: {},
      uncontested: true,
    }
    event(state, winner.identity, `${winner.name} levou ${amount} fichas sem mostrar as cartas.`)
  } else {
    state.revealed = Object.fromEntries(survivors.map((p) => [p.identity, engine.hands[p.identity]!]))
    const result = settlePokerPots(state.players, state.board, engine.hands, state.dealer)
    for (const [id, amount] of Object.entries(result.refunds)) {
      state.players.find((p) => p.identity === id)!.stack += amount
      refunds[id] = (refunds[id] ?? 0) + amount
    }
    state.result = { ...result, refunds, uncontested: false }
    event(state, '', 'Showdown · os potes foram distribuídos.')
  }
  state.players.forEach((p) => {
    p.stack += state.result!.payouts[p.identity] ?? 0
    p.bet = 0
    p.committed = 0
    p.allIn = false
  })
  state.phase = state.players.filter((p) => p.stack > 0 && !p.away).length < 2 ? 'finished' : 'hand-result'
  state.current = ''
  state.pending = []
  setTurn(state)
}
const nextStreet = (engine: PokerEngine) => {
  const state = engine.state
  engine.deck.pop() // burn
  const count = state.street === 'preflop' ? 3 : 1
  state.board.push(...Array.from({ length: count }, () => engine.deck.pop()!))
  state.street = state.street === 'preflop' ? 'flop' : state.street === 'flop' ? 'turn' : 'river'
  state.currentBet = 0
  state.lastFullRaise = state.settings.bigBlind
  state.current = ''
  state.turnId = ''
  state.players.forEach((p) => {
    p.bet = 0
    p.actedAt = null
    if (canAct(p)) p.action = ''
  })
  state.pending = clockwise(state, state.dealer, canAct).map((p) => p.identity)
  event(
    state,
    '',
    state.street === 'flop' ? 'Flop na mesa.' : state.street === 'turn' ? 'Turn na mesa.' : 'River na mesa.',
  )
}
const finishAction = (engine: PokerEngine) => {
  const state = engine.state
  state.pending = state.pending.filter((id) => state.players.some((p) => p.identity === id && canAct(p)))
  if (!state.players.some(live)) {
    const refunds = { ...state.returned }
    state.players.forEach((p) => {
      refunds[p.identity] = (refunds[p.identity] ?? 0) + p.committed
      p.stack += p.committed
      p.committed = 0
      p.bet = 0
    })
    state.result = { payouts: {}, refunds, pots: [], hands: {}, bestCards: {}, uncontested: true }
    state.phase = 'finished'
    state.pending = []
    setTurn(state)
    event(state, '', 'Mesa encerrada sem jogadores. As apostas foram devolvidas.')
    return
  }
  if (state.players.filter(live).length === 1) {
    returnUncalled(state)
    settle(engine, true)
    return
  }
  while (state.phase === 'playing') {
    const actors = state.players.filter(canAct)
    // A lone player cannot bet against opponents who are already all-in.
    if (actors.length === 1) state.currentBet = Math.max(...state.players.map((p) => p.bet))
    if ((actors.length === 1 && actors[0]!.bet >= state.currentBet) || actors.length === 0) state.pending = []
    if (state.pending.length) {
      setTurn(state)
      return
    }
    returnUncalled(state)
    if (state.street === 'river') {
      settle(engine, false)
      return
    }
    nextStreet(engine)
  }
}

export const dealPokerHand = (previous: PokerEngine, random?: () => number): PokerEngine => {
  if (previous.state.phase === 'playing') throw new Error('Termine a mão atual antes de distribuir novas cartas.')
  const engine = cloneEngine(previous),
    state = engine.state
  const eligible = state.players.filter((p) => p.stack > 0 && !p.away)
  if (eligible.length < 2) throw new Error('É preciso ter duas pessoas com fichas na mesa.')
  const dealer = state.handNumber
    ? clockwise(state, state.dealer, (p) => eligible.includes(p))[0]!
    : eligible[Math.floor((random?.() ?? Math.random()) * eligible.length)]!
  state.gameId = crypto.randomUUID()
  state.handNumber += 1
  state.phase = 'playing'
  state.street = 'preflop'
  state.dealer = dealer.identity
  state.board = []
  state.result = null
  state.revealed = {}
  state.returned = {}
  state.events = []
  state.current = ''
  state.turnId = ''
  state.players.forEach((p) => {
    p.inHand = eligible.includes(p)
    p.folded = !p.inHand
    p.bet = 0
    p.committed = 0
    p.allIn = false
    p.actedAt = null
    p.action = p.inHand ? '' : p.away ? 'Fora da mesa' : 'Sem fichas'
  })
  const small = eligible.length === 2 ? dealer : clockwise(state, dealer.identity, (p) => p.inHand)[0]!
  const big = clockwise(state, small.identity, (p) => p.inHand)[0]!
  state.smallBlind = small.identity
  state.bigBlind = big.identity
  pay(small, state.settings.bigBlind / 2)
  small.action = 'Small blind'
  pay(big, state.settings.bigBlind)
  big.action = 'Big blind'
  state.currentBet = state.settings.bigBlind
  state.lastFullRaise = state.settings.bigBlind
  engine.deck = makePokerDeck(random)
  engine.hands = Object.fromEntries(state.players.filter((p) => p.inHand).map((p) => [p.identity, []]))
  const dealOrder = clockwise(state, dealer.identity, (p) => p.inHand)
  for (let card = 0; card < 2; card++)
    for (const player of dealOrder) engine.hands[player.identity]!.push(engine.deck.pop()!)
  state.pending = clockwise(state, big.identity, canAct).map((p) => p.identity)
  event(state, '', `Mão ${state.handNumber} · blinds ${state.settings.bigBlind / 2}/${state.settings.bigBlind}.`)
  finishAction(engine)
  return engine
}
export const createPokerMatch = (
  members: Array<{ identity: string; name: string }>,
  settings: PokerSettings = defaultPokerSettings,
  random?: () => number,
): PokerEngine => {
  if (members.length < 2 || members.length > 6 || new Set(members.map((p) => p.identity)).size !== members.length)
    throw new Error('Poker aceita de 2 a 6 pessoas diferentes.')
  const parsed = readPokerSettings(settings)
  if (!parsed) throw new Error('Configuração de fichas ou blinds inválida.')
  const state = {
    ...emptyPokerState(''),
    matchId: crypto.randomUUID(),
    settings: parsed,
    players: members.map((p) => ({
      ...p,
      stack: parsed.startingStack,
      bet: 0,
      committed: 0,
      inHand: false,
      folded: false,
      allIn: false,
      away: false,
      actedAt: null,
      action: '',
    })),
  }
  return dealPokerHand({ state, deck: [], hands: {} }, random)
}
export const applyPokerAction = (previous: PokerEngine, identity: string, action: PokerAction): PokerEngine => {
  const engine = cloneEngine(previous),
    state = engine.state
  const legal = pokerLegalActions(state, identity),
    player = state.players.find((p) => p.identity === identity)
  if (!legal.active || !player) throw new Error('Ainda não é a sua vez de jogar.')
  if (action.type === 'fold') {
    player.folded = true
    player.action = 'Fold'
    event(state, identity, `${player.name} desistiu.`)
  } else if (action.type === 'check') {
    if (!legal.canCheck) throw new Error('Existe uma aposta para cobrir. Pague ou desista.')
    player.action = 'Check'
    player.actedAt = state.currentBet
    event(state, identity, `${player.name} passou.`)
  } else if (action.type === 'call' || (action.type === 'all-in' && legal.maxTotal <= state.currentBet)) {
    if (!legal.toCall) throw new Error('Não há aposta para pagar.')
    const amount = pay(player, legal.toCall)
    player.actedAt = state.currentBet
    player.action = player.allIn ? 'All-in' : `Call ${amount}`
    event(state, identity, `${player.name} pagou ${amount}${player.allIn ? ' · all-in' : ''}.`)
  } else {
    const total = action.type === 'all-in' ? legal.maxTotal : action.type === 'raise' ? action.total : NaN
    if (!legal.canRaise) throw new Error('A ação não foi reaberta para aumentar, ou não há adversário com fichas.')
    if (!integer(total, state.currentBet + 1, legal.maxTotal)) throw new Error('Escolha um valor de aposta válido.')
    if (total < legal.minRaise && total !== legal.maxTotal)
      throw new Error(`O aumento mínimo é para ${legal.minRaise} fichas.`)
    const raise = total - state.currentBet,
      before = state.currentBet
    pay(player, total - player.bet)
    state.currentBet = total
    if (raise >= state.lastFullRaise) state.lastFullRaise = raise
    player.actedAt = total
    player.action = player.allIn ? 'All-in' : before ? `Raise ${total}` : `Bet ${total}`
    state.pending = clockwise(state, identity, canAct).map((p) => p.identity)
    event(
      state,
      identity,
      `${player.name} ${player.allIn ? 'foi all-in por' : before ? 'aumentou para' : 'apostou'} ${total}.`,
    )
  }
  state.pending = state.pending.filter((id) => id !== identity)
  finishAction(engine)
  return engine
}
export const syncPokerMembers = (previous: PokerEngine, connected: Set<string>): PokerEngine => {
  const engine = cloneEngine(previous),
    state = engine.state
  state.players.forEach((player) => {
    const away = !connected.has(player.identity)
    if (away && !player.away && state.phase === 'playing' && live(player) && !player.allIn) {
      player.folded = true
      player.action = 'Saiu · fold'
      event(state, player.identity, `${player.name} saiu e desistiu da mão.`)
    }
    player.away = away
  })
  if (state.phase === 'playing') finishAction(engine)
  return engine
}
