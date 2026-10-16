/** Truco Mineiro, four alternating seats. Raising pauses a card turn; it never consumes it. */
export type TrucoRank = '4' | '5' | '6' | '7' | 'Q' | 'J' | 'K' | 'A' | '2' | '3'
export type TrucoSuit = 'paus' | 'ouros' | 'copas' | 'espadas'
export type TrucoTeam = 0 | 1
export type TrucoStake = 2 | 4 | 6 | 10 | 12
export interface TrucoCard { id: string; rank: TrucoRank; suit: TrucoSuit }
export interface TrucoPlayer { identity: string; name: string; seat: number; team: TrucoTeam; connected: boolean }
export interface TrucoPlay { identity: string; card: TrucoCard }
export interface TrucoRaise { team: TrucoTeam; identity: string; targetStake: Exclude<TrucoStake, 2> }
export interface TrucoRoomState {
  /** Changes for EVERY deal, so a delayed private hand/action cannot affect the next deal. */
  gameId: string
  matchId: string
  handNumber: number
  stepId: string
  controllerIdentity: string
  revision: number
  phase: 'lobby' | 'playing' | 'hand-result' | 'finished'
  players: TrucoPlayer[]
  scores: [number, number]
  dealerSeat: number
  manoSeat: number
  /** The next CARD player, including while the other team negotiates an increase. */
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
export interface TrucoEngine { state: TrucoRoomState; hands: Record<string, TrucoCard[]> }
export type TrucoMove = { type: 'play'; cardId: string } | { type: 'call-truco' | 'accept-raise' | 'refuse-raise' }
export const TRUCO_RANKS: TrucoRank[] = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3']
export const TRUCO_SUITS: TrucoSuit[] = ['paus', 'ouros', 'copas', 'espadas']
const manilhas: Record<string, number> = { '7-ouros': 11, 'A-espadas': 12, '7-copas': 13, '4-paus': 14 }
export const trucoCardPower = (card: TrucoCard) => manilhas[card.id] ?? TRUCO_RANKS.indexOf(card.rank) + 1
export const trucoNextStake = (stake: TrucoStake): TrucoRaise['targetStake'] | null =>
  stake === 2 ? 4 : stake === 4 ? 6 : stake === 6 ? 10 : stake === 10 ? 12 : null
export const trucoPlayerAt = (state: TrucoRoomState, seat = state.currentSeat) => state.players.find((p) => p.seat === seat)
export const trucoExpectedSeat = (state: TrucoRoomState) => (state.trickLeaderSeat + state.trickPlays.length) % 4
export const trucoPaused = (state: TrucoRoomState) => state.players.some((p) => !p.connected)
export const trucoCanRespond = (state: TrucoRoomState, identity: string) => {
  const player = state.players.find((p) => p.identity === identity)
  return Boolean(state.phase === 'playing' && !trucoPaused(state) && player && state.pendingRaise && player.team !== state.pendingRaise.team)
}
export const trucoCanPlay = (state: TrucoRoomState, identity: string) =>
  state.phase === 'playing' && !trucoPaused(state) && !state.pendingRaise &&
  trucoPlayerAt(state)?.identity === identity && !state.trickPlays.some((p) => p.identity === identity)
export const trucoCanRaise = (state: TrucoRoomState, identity: string) => {
  const player = state.players.find((p) => p.identity === identity)
  if (state.pendingRaise) return trucoCanRespond(state, identity) && trucoNextStake(state.pendingRaise.targetStake) !== null
  return Boolean(player && trucoCanPlay(state, identity) && state.lastRaiseTeam !== player.team && trucoNextStake(state.stake))
}
export const emptyTrucoState = (controllerIdentity: string, revision = 0): TrucoRoomState => ({
  gameId: '', matchId: '', handNumber: 0, stepId: '', controllerIdentity, revision, phase: 'lobby',
  players: [], scores: [0, 0], dealerSeat: 0, manoSeat: 1, currentSeat: 1, trickLeaderSeat: 1,
  trickIndex: 0, trickPlays: [], lastTrick: [], trickWinners: [], stake: 2,
  lastRaiseTeam: null, pendingRaise: null, handWinner: null, lastHandMessage: '',
})
export const makeTrucoDeck = (random = Math.random): TrucoCard[] => {
  const deck = TRUCO_RANKS.flatMap((rank) => TRUCO_SUITS.map((suit) => ({ id: `${rank}-${suit}`, rank, suit })))
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j]!, deck[i]!]
  }
  return deck
}
const clone = (engine: TrucoEngine): TrucoEngine => structuredClone(engine)
const decision = (engine: TrucoEngine) => { engine.state.stepId = crypto.randomUUID(); return engine }
const deal = (previous: TrucoEngine, dealerSeat: number, random?: () => number): TrucoEngine => {
  const engine = clone(previous), state = engine.state, deck = makeTrucoDeck(random)
  const mano = (dealerSeat + 1) % 4
  engine.hands = Object.fromEntries(state.players.map((p) => [p.identity, []]))
  for (let round = 0; round < 3; round++) for (let offset = 0; offset < 4; offset++) {
    engine.hands[trucoPlayerAt(state, (mano + offset) % 4)!.identity]!.push(deck.pop()!)
  }
  Object.assign(state, {
    gameId: crypto.randomUUID(), handNumber: state.handNumber + 1, phase: 'playing',
    dealerSeat, manoSeat: mano, currentSeat: mano, trickLeaderSeat: mano, trickIndex: 0,
    trickPlays: [], lastTrick: [], trickWinners: [], stake: 2,
    lastRaiseTeam: null, pendingRaise: null, handWinner: null, lastHandMessage: '',
  })
  return decision(engine)
}
export const createTrucoMatch = (
  members: Array<{ identity: string; name: string }>,
  options: { dealerSeat?: number; random?: () => number } = {},
): TrucoEngine => {
  if (members.length !== 4 || members.some((p) => !p.identity.trim()) || new Set(members.map((p) => p.identity)).size !== 4)
    throw new Error('Truco Mineiro precisa de 4 pessoas: duas duplas alternadas.')
  const dealerSeat = options.dealerSeat ?? 0
  if (!Number.isInteger(dealerSeat) || dealerSeat < 0 || dealerSeat > 3) throw new Error('Lugar do distribuidor inválido.')
  const players = members.map((p, seat): TrucoPlayer => ({
    identity: p.identity, name: p.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || 'Jogador',
    seat, team: seat % 2 as TrucoTeam, connected: true,
  }))
  return deal({ state: { ...emptyTrucoState(''), matchId: crypto.randomUUID(), players }, hands: {} }, dealerSeat, options.random)
}
export const resolveTrucoTrick = (plays: TrucoPlay[], players: TrucoPlayer[]): { team: TrucoTeam; seat: number } | null => {
  if (plays.length !== 4 || new Set(plays.map((p) => p.identity)).size !== 4) throw new Error('A vaza precisa de uma carta de cada jogador.')
  const power = Math.max(...plays.map((p) => trucoCardPower(p.card)))
  const top = plays.filter((p) => trucoCardPower(p.card) === power).map((play) => players.find((p) => p.identity === play.identity)!)
  if (top.some((p) => !p)) throw new Error('Jogador inválido na vaza.')
  // Two partners with the same highest rank still win; only opposing teams tie.
  return new Set(top.map((p) => p.team)).size === 1 ? { team: top[0]!.team, seat: top[0]!.seat } : null
}
export const resolveTrucoHand = (winners: Array<TrucoTeam | null>): { complete: boolean; winner: TrucoTeam | null } => {
  if (winners.length < 2) return { complete: false, winner: null }
  const [first, second, third] = winners
  if (first !== null && (second === first || second === null)) return { complete: true, winner: first! }
  if (first === null && second !== null) return { complete: true, winner: second! }
  if (winners.length < 3) return { complete: false, winner: null }
  return { complete: true, winner: third ?? first ?? null }
}
const finishHand = (engine: TrucoEngine, winner: TrucoTeam | null, message: string) => {
  const state = engine.state
  if (winner !== null) state.scores[winner] = Math.min(12, state.scores[winner] + state.stake)
  state.phase = state.scores.some((score) => score >= 12) ? 'finished' : 'hand-result'
  state.handWinner = winner
  state.pendingRaise = null
  state.lastHandMessage = message
}
export const applyTrucoMove = (previous: TrucoEngine, identity: string, move: TrucoMove): TrucoEngine => {
  const current = previous.state, player = current.players.find((p) => p.identity === identity)
  if (!player) throw new Error('Você não está na partida atual.')
  if (current.phase !== 'playing') throw new Error('Não há uma mão em andamento.')
  if (trucoPaused(current)) throw new Error('Aguardando os quatro jogadores voltarem à mesa.')
  if (current.currentSeat !== trucoExpectedSeat(current) || new Set(current.trickPlays.map((p) => p.identity)).size !== current.trickPlays.length ||
    current.trickPlays.some((play, index) => current.players.find((p) => p.identity === play.identity)?.seat !== (current.trickLeaderSeat + index) % 4))
    throw new Error('A mesa recebeu uma ordem de jogadas inválida. Iniciem outra partida.')
  const engine = clone(previous), state = engine.state
  if (move.type === 'call-truco') {
    if (!trucoCanRaise(current, identity)) throw new Error('Só a dupla que pode responder ou o jogador da vez pode aumentar, alternando as duplas.')
    const targetStake = trucoNextStake(current.pendingRaise?.targetStake ?? current.stake)!
    if (current.pendingRaise) {
      state.stake = current.pendingRaise.targetStake
      state.lastRaiseTeam = current.pendingRaise.team
    }
    state.pendingRaise = { identity, team: player.team, targetStake }
  } else if (move.type === 'accept-raise' || move.type === 'refuse-raise') {
    if (!trucoCanRespond(current, identity)) throw new Error('Não há um pedido da outra dupla para responder.')
    const pending = current.pendingRaise!
    if (move.type === 'accept-raise') {
      state.stake = pending.targetStake
      state.lastRaiseTeam = pending.team
      state.pendingRaise = null
    } else finishHand(engine, pending.team, `A dupla ${pending.team + 1} ganhou ${state.stake} pontos porque a aposta foi recusada.`)
  } else if (move.type === 'play') {
    if (current.pendingRaise) throw new Error('Respondam à aposta antes de jogar uma carta.')
    if (!trucoCanPlay(current, identity)) throw new Error('Ainda não é a sua vez.')
    const hand = engine.hands[identity], selected = hand?.find((card) => card.id === move.cardId)
    if (!selected) throw new Error('Essa carta não está na sua mão.')
    hand!.splice(hand!.indexOf(selected), 1)
    state.trickPlays.push({ identity, card: selected })
    if (state.trickPlays.length < 4) state.currentSeat = trucoExpectedSeat(state)
    else {
      const result = resolveTrucoTrick(state.trickPlays, state.players)
      state.lastTrick = state.trickPlays
      state.trickPlays = []
      state.trickWinners.push(result?.team ?? null)
      state.trickIndex = state.trickWinners.length
      state.trickLeaderSeat = result?.seat ?? state.trickLeaderSeat
      state.currentSeat = state.trickLeaderSeat
      const handResult = resolveTrucoHand(state.trickWinners)
      if (handResult.complete) finishHand(engine, handResult.winner,
        handResult.winner === null ? 'As três vazas empataram. Ninguém marcou pontos.' : `A dupla ${handResult.winner + 1} ganhou a mão por ${state.stake} pontos.`)
    }
  } else throw new Error('Jogada de Truco inválida.')
  return decision(engine)
}
export const dealNextTrucoHand = (previous: TrucoEngine, random?: () => number) => {
  if (previous.state.phase !== 'hand-result') throw new Error('A mão atual ainda não terminou ou a partida já acabou.')
  if (trucoPaused(previous.state)) throw new Error('Os quatro jogadores precisam estar na mesa para distribuir.')
  return deal(previous, (previous.state.dealerSeat + 1) % 4, random)
}
export const syncTrucoMembers = (previous: TrucoEngine, connected: ReadonlySet<string>): TrucoEngine => {
  if (previous.state.players.every((p) => p.connected === connected.has(p.identity))) return previous
  const engine = clone(previous)
  for (const p of engine.state.players) p.connected = connected.has(p.identity)
  return decision(engine)
}
