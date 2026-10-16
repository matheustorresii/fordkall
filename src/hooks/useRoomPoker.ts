import { useCallback, useEffect, useRef } from 'react'
import type { Room } from 'livekit-client'
import { useRoomGameProtocol, type RoomGameProtocolContext } from './useRoomGameProtocol'
import { gameMembers, gameStartError, type RoomGameParticipation } from './useRoomGameParticipation'
import {
  applyPokerAction,
  advancePokerFlow,
  createPokerMatch,
  defaultPokerSettings,
  emptyPokerState,
  isPokerCard,
  readPokerSettings,
  syncPokerMembers,
  rebuyPokerStack,
  resumePokerMatch,
  type PokerAction,
  type PokerCard,
  type PokerEngine,
  type PokerSettings,
  type PokerState,
} from '../games/poker'

export const POKER_TOPIC = 'ford-kall.poker.v2'
type Command =
  | { type: 'start'; matchId: string; settings: PokerSettings }
  | { type: 'action'; gameId: string; turnId: string; action: PokerAction }
  | { type: 'next'; gameId: string }
  | { type: 'rebuy'; gameId: string }
  | { type: 'resume'; gameId: string }
  | { type: 'timeout'; gameId: string; turnId: string }
  | { type: 'advance'; gameId: string; transitionAt: number }
  | { type: 'sync'; gameId: string }
  | { type: 'reset' }
const emptyPrivate: PokerCard[] = []
const text = (value: unknown, max = 128): value is string =>
  typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
const number = (value: unknown, max = 600000): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max
const parseCards = (value: unknown, max: number): PokerCard[] | null =>
  Array.isArray(value) && value.length <= max && value.every(isPokerCard) && new Set(value).size === value.length
    ? [...value]
    : null
const privateCards = (value: unknown): PokerCard[] | null => {
  const cards = parseCards(value, 2)
  return cards && (cards.length === 0 || cards.length === 2) ? cards : null
}

/** Only explicitly selected public fields survive the wire parser. No deck or private hands. */
export const parsePokerState = (value: unknown): PokerState | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as PokerState,
    settings = readPokerSettings(raw.settings),
    board = parseCards(raw.board, 5)
  if (
    !settings ||
    !board ||
    !text(raw.gameId, 80) ||
    !text(raw.matchId, 80) ||
    !text(raw.controllerIdentity) ||
    !number(raw.revision, Number.MAX_SAFE_INTEGER) ||
    !number(raw.handNumber, Number.MAX_SAFE_INTEGER) ||
    !['lobby', 'playing', 'runout', 'hand-result', 'finished'].includes(raw.phase) ||
    !['preflop', 'flop', 'turn', 'river'].includes(raw.street) ||
    !Array.isArray(raw.players) ||
    raw.players.length > 6 ||
    !number(raw.currentBet) ||
    !number(raw.lastFullRaise) ||
    !text(raw.dealer) ||
    !text(raw.smallBlind) ||
    !text(raw.bigBlind) ||
    !text(raw.current) ||
    !text(raw.turnId, 80) ||
    !number(raw.turnExpiresAt, Number.MAX_SAFE_INTEGER) ||
    !number(raw.transitionAt ?? 0, Number.MAX_SAFE_INTEGER) ||
    !Array.isArray(raw.pending) ||
    !Array.isArray(raw.events) ||
    raw.events.length > 40
  )
    return null
  const players = raw.players.map((p) =>
    p &&
    text(p.identity) &&
    p.identity &&
    text(p.name, 80) &&
    p.name &&
    number(p.stack) &&
    number(p.rebuys ?? 0, 6000) &&
    number(p.bet) &&
    number(p.committed) &&
    p.committed >= p.bet &&
    ['inHand', 'folded', 'allIn', 'away'].every((key) => typeof p[key as keyof typeof p] === 'boolean') &&
    (p.actedAt === null || number(p.actedAt)) &&
    text(p.action, 80)
      ? {
          identity: p.identity,
          name: p.name,
          stack: p.stack,
          rebuys: p.rebuys ?? 0,
          bet: p.bet,
          committed: p.committed,
          inHand: p.inHand,
          folded: p.folded,
          allIn: p.allIn,
          away: p.away,
          actedAt: p.actedAt,
          action: p.action,
        }
      : null,
  )
  if (players.some((p) => !p)) return null
  const validPlayers = players.filter((p) => p !== null),
    ids = new Set(validPlayers.map((p) => p.identity))
  const validIds = (list: unknown): list is string[] =>
    Array.isArray(list) && list.length <= 6 && new Set(list).size === list.length && list.every((id) => ids.has(id))
  const amounts = (record: unknown): record is Record<string, number> =>
    Boolean(
      record &&
        typeof record === 'object' &&
        !Array.isArray(record) &&
        Object.entries(record).every(([id, amount]) => ids.has(id) && number(amount)),
    )
  if (
    ids.size !== players.length ||
    !validIds(raw.pending) ||
    !amounts(raw.returned) ||
    !raw.revealed ||
    typeof raw.revealed !== 'object'
  )
    return null
  const revealed: Record<string, PokerCard[]> = {}
  for (const [id, value] of Object.entries(raw.revealed)) {
    const cards = privateCards(value)
    if (!ids.has(id) || !cards || cards.length !== 2) return null
    revealed[id] = cards
  }
  const shown = [...board, ...Object.values(revealed).flat()]
  if (new Set(shown).size !== shown.length || (raw.phase === 'playing' && Object.keys(revealed).length)) return null
  const events = raw.events.map((e) =>
    e &&
    number(e.id, Number.MAX_SAFE_INTEGER) &&
    text(e.identity) &&
    (!e.identity || ids.has(e.identity)) &&
    text(e.text, 240)
      ? { id: e.id, identity: e.identity, text: e.text }
      : null,
  )
  if (events.some((e) => !e)) return null
  let result: PokerState['result'] = null
  if (raw.result !== null) {
    const r = raw.result
    if (
      !r ||
      !amounts(r.payouts) ||
      !amounts(r.refunds) ||
      !Array.isArray(r.pots) ||
      r.pots.length > 6 ||
      typeof r.uncontested !== 'boolean' ||
      !r.hands ||
      typeof r.hands !== 'object' ||
      !r.bestCards ||
      typeof r.bestCards !== 'object'
    )
      return null
    const pots = r.pots.map((p) =>
      p &&
      number(p.amount) &&
      validIds(p.eligible) &&
      validIds(p.winners) &&
      p.winners.every((id) => p.eligible.includes(id))
        ? { amount: p.amount, eligible: [...p.eligible], winners: [...p.winners] }
        : null,
    )
    if (
      pots.some((p) => !p) ||
      Object.entries(r.hands).some(([id, name]) => !ids.has(id) || !text(name, 40)) ||
      Object.entries(r.bestCards).some(([id, cards]) => !ids.has(id) || parseCards(cards, 5)?.length !== 5)
    )
      return null
    result = {
      payouts: { ...r.payouts },
      refunds: { ...r.refunds },
      pots: pots.filter((p) => p !== null),
      hands: { ...r.hands },
      bestCards: Object.fromEntries(Object.entries(r.bestCards).map(([id, cards]) => [id, [...cards]])),
      uncontested: r.uncontested,
    }
  }
  if (
    raw.phase === 'lobby'
      ? raw.gameId || raw.matchId || players.length || raw.handNumber || board.length || result
      : !raw.gameId ||
        !raw.matchId ||
        players.length < 2 ||
        !raw.handNumber ||
        !ids.has(raw.dealer) ||
        !ids.has(raw.smallBlind) ||
        !ids.has(raw.bigBlind) ||
        board.length !== { preflop: 0, flop: 3, turn: 4, river: 5 }[raw.street]
  )
    return null
  if (
    raw.phase === 'playing'
      ? result || !raw.pending.length || raw.pending[0] !== raw.current || !raw.turnId
      : raw.current || raw.pending.length || (raw.phase === 'runout' ? result || !raw.transitionAt : raw.phase !== 'lobby' && !result)
  )
    return null
  if (raw.phase !== 'playing' && (raw.turnId || raw.turnExpiresAt)) return null
  const championIdentity = raw.championIdentity ?? (raw.phase === 'finished' ? validPlayers.find((p) => p.stack > 0 && !p.away)?.identity ?? '' : '')
  if (!text(championIdentity) || (championIdentity && (!ids.has(championIdentity) || raw.phase !== 'finished'))) return null
  if (!['runout', 'hand-result'].includes(raw.phase) && raw.transitionAt) return null
  if (raw.phase === 'runout') {
    const contenders = validPlayers.filter((p) => p.inHand && !p.folded)
    if (contenders.length < 2 || contenders.length !== Object.keys(revealed).length || contenders.some((p) => !revealed[p.identity]))
      return null
  }
  return {
    gameId: raw.gameId,
    matchId: raw.matchId,
    controllerIdentity: raw.controllerIdentity,
    revision: raw.revision,
    phase: raw.phase,
    street: raw.street,
    handNumber: raw.handNumber,
    settings,
    players: validPlayers,
    board,
    dealer: raw.dealer,
    smallBlind: raw.smallBlind,
    bigBlind: raw.bigBlind,
    current: raw.current,
    currentBet: raw.currentBet,
    lastFullRaise: raw.lastFullRaise,
    pending: [...raw.pending],
    turnId: raw.turnId,
    turnExpiresAt: raw.turnExpiresAt,
    transitionAt: raw.transitionAt ?? 0,
    championIdentity,
    revealed,
    returned: { ...raw.returned },
    result,
    events: events.filter((e) => e !== null),
  }
}
const parseCommand = (value: unknown): Command | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.type === 'reset') return { type: 'reset' }
  if (raw.type === 'start') {
    const settings = readPokerSettings(raw.settings)
    return settings && text(raw.matchId, 80) ? { type: 'start', settings, matchId: raw.matchId } : null
  }
  if (!text(raw.gameId, 80) || !raw.gameId) return null
  if (raw.type === 'advance' && number(raw.transitionAt, Number.MAX_SAFE_INTEGER) && raw.transitionAt > 0)
    return { type: 'advance', gameId: raw.gameId, transitionAt: raw.transitionAt }
  if (raw.type === 'next' || raw.type === 'sync' || raw.type === 'rebuy' || raw.type === 'resume') return { type: raw.type, gameId: raw.gameId }
  if (!text(raw.turnId, 80) || !raw.turnId) return null
  if (raw.type === 'timeout') return { type: 'timeout', gameId: raw.gameId, turnId: raw.turnId }
  const action = raw.action as PokerAction | undefined
  if (
    raw.type !== 'action' ||
    !action ||
    typeof action !== 'object' ||
    !['fold', 'check', 'call', 'raise', 'all-in'].includes(action.type)
  )
    return null
  if (action.type === 'raise' && !number(action.total)) return null
  return {
    type: 'action',
    gameId: raw.gameId,
    turnId: raw.turnId,
    action: action.type === 'raise' ? { type: 'raise', total: action.total } : { type: action.type },
  }
}
type Context = RoomGameProtocolContext<PokerState, PokerCard[]>
const cleanName = (name: string) =>
  name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 80) || 'Jogador'

export const useRoomPoker = (room: Room, participation?: RoomGameParticipation) => {
  // The elected controller owns the deck. Peers only receive their own two cards.
  const engineRef = useRef<PokerEngine | null>(null)
  const handleCommand = useCallback(
    (command: Command, sender: string, context: Context): string | null => {
      const current = context.state,
        connected = new Set(gameMembers(room, 'poker', participation).map((member) => member.identity))
      if (sender !== room.localParticipant.identity && !room.remoteParticipants.has(sender)) return 'Você não está nesta sala.'
      if (!connected.has(sender) && !['sync', 'timeout', 'advance', 'reset'].includes(command.type)) return 'Você está só assistindo.'
      const save = (engine: PokerEngine) => {
        const changedHand = engine.state.gameId !== current.gameId
        engine.state = {
          ...engine.state,
          controllerIdentity: room.localParticipant.identity,
          revision: current.revision,
        }
        if (!context.commit(() => engine.state)) return 'A mesa está sincronizando. Tente de novo.'
        engineRef.current = engine
        if (changedHand) context.replaceSecrets(engine.state.gameId, engine.hands)
        return null
      }
      if (command.type === 'reset') {
        engineRef.current = null
        context.commit(() => emptyPokerState(room.localParticipant.identity))
        context.replaceSecrets('', {})
        return null
      }
      if (command.type === 'start') {
        const startError = gameStartError('poker', sender, participation)
        if (startError) return startError
        if (command.matchId !== current.matchId || !['lobby', 'finished'].includes(current.phase))
          return 'Já existe uma mesa em andamento.'
        const members = gameMembers(room, 'poker', participation).map((p) => ({
          identity: p.identity,
          name: cleanName(p.name || p.identity),
        }))
        try {
          return save(createPokerMatch(members, command.settings))
        } catch (e) {
          return e instanceof Error ? e.message : 'Não foi possível abrir a mesa.'
        }
      }
      // A visibility wake-up can race a timer already in the command queue. Internal ticks are idempotent.
      if (command.type === 'advance' && sender === room.localParticipant.identity &&
          (command.gameId !== current.gameId || command.transitionAt !== current.transitionAt)) return null
      if (command.gameId !== current.gameId) return 'A mão mudou. Confira suas novas cartas.'
      const previous = engineRef.current
      if (!previous || previous.state.gameId !== current.gameId)
        return 'Quem distribuía as cartas saiu. Iniciem outra mesa.'
      const engine = { ...previous, state: current }
      try {
        if (command.type === 'sync')
          return sender === room.localParticipant.identity
            ? save(syncPokerMembers(engine, connected))
            : 'Ação reservada à mesa.'
        if (command.type === 'advance') {
          if (sender !== room.localParticipant.identity || current.transitionAt !== command.transitionAt)
            return 'A mesa já avançou ou essa ação não é sua.'
          const synced = syncPokerMembers(engine, connected)
          return synced.state.phase === 'finished' ? save(synced) : save(advancePokerFlow(synced))
        }
        if (!current.players.some((p) => p.identity === sender) && command.type !== 'timeout')
          return 'Você está assistindo a esta partida.'
        if (command.type === 'rebuy') return save(rebuyPokerStack(syncPokerMembers(engine, connected), sender))
        if (command.type === 'resume') return save(resumePokerMatch(syncPokerMembers(engine, connected)))
        if (command.type === 'next') {
          if (current.phase !== 'hand-result') return 'A próxima mão é automática. Uma nova partida precisa ser iniciada.'
          const synced = syncPokerMembers(engine, connected)
          return synced.state.phase === 'finished' ? save(synced) : save(advancePokerFlow(synced))
        }
        if (current.turnId !== command.turnId || current.phase !== 'playing') return 'A vez mudou. Confira a mesa.'
        if (command.type === 'timeout') {
          if (sender !== room.localParticipant.identity || !current.turnExpiresAt || Date.now() < current.turnExpiresAt)
            return 'O tempo desta jogada ainda não acabou.'
          const player = current.players.find((p) => p.identity === current.current)!
          return save(
            applyPokerAction(engine, current.current, { type: player.bet >= current.currentBet ? 'check' : 'fold' }),
          )
        }
        return save(applyPokerAction(engine, sender, command.action))
      } catch (e) {
        return e instanceof Error ? e.message : 'Não foi possível concluir sua jogada.'
      }
    },
    [room, participation],
  )
  const protocol = useRoomGameProtocol<PokerState, Command, PokerCard[]>({
    room,
    topic: POKER_TOPIC,
    emptyState: emptyPokerState,
    parseState: parsePokerState,
    parseCommand,
    parsePrivate: privateCards,
    emptyPrivate,
    handleCommand,
  })
  const { state, dispatch, isController, participantRevision } = protocol
  useEffect(() => {
    if (!isController || !['runout', 'hand-result'].includes(state.phase) || !state.transitionAt) return
    const advance = () => dispatch({ type: 'advance', gameId: state.gameId, transitionAt: state.transitionAt })
    const timer = window.setTimeout(advance, Math.max(1, state.transitionAt - Date.now() + 30))
    const visible = () => { if (!document.hidden && Date.now() >= state.transitionAt) advance() }
    document.addEventListener('visibilitychange', visible)
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', visible) }
  }, [isController, state.phase, state.gameId, state.transitionAt, dispatch])
  useEffect(() => {
    if (isController && state.gameId) dispatch({ type: 'sync', gameId: state.gameId })
  }, [isController, participantRevision, state.gameId, dispatch, participation?.state.revision])
  useEffect(() => {
    if (!isController || state.phase !== 'playing' || !state.turnExpiresAt) return
    const timer = window.setTimeout(
      () => dispatch({ type: 'timeout', gameId: state.gameId, turnId: state.turnId }),
      Math.max(1, state.turnExpiresAt - Date.now() + 50),
    )
    return () => window.clearTimeout(timer)
  }, [isController, state.phase, state.gameId, state.turnId, state.turnExpiresAt, dispatch])
  return {
    state,
    hand: protocol.localPrivate,
    error: protocol.error,
    clearError: protocol.clearError,
    isController,
    participantCount: gameMembers(room, 'poker', participation).length,
    start: (settings: PokerSettings = defaultPokerSettings) =>
      dispatch({ type: 'start', matchId: state.matchId, settings }),
    act: (action: PokerAction) => dispatch({ type: 'action', gameId: state.gameId, turnId: state.turnId, action }),
    nextHand: () => dispatch({ type: 'next', gameId: state.gameId }),
    rebuy: () => dispatch({ type: 'rebuy', gameId: state.gameId }),
    resume: () => dispatch({ type: 'resume', gameId: state.gameId }),
    reset: () => dispatch({ type: 'reset' }),
  }
}
