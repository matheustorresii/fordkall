import { COUP_ACTIONS, COUP_ROLES, coupActions, readCoupSettings } from './coup.ts'
import type {
  CoupCard,
  CoupEvent,
  CoupLoss,
  CoupMove,
  CoupPending,
  CoupPhase,
  CoupPrivate,
  CoupRole,
  CoupState,
} from './coup.ts'

const text = (v: unknown, max = 128): v is string =>
  typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v)
const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
  Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max
const role = (v: unknown): v is CoupRole => COUP_ROLES.includes(v as CoupRole)
const cards = (v: unknown, max: number): CoupCard[] | null => {
  if (
    !Array.isArray(v) ||
    v.length > max ||
    v.some((c) => !c || !text(c.id, 80) || !c.id || !role(c.role)) ||
    new Set(v.map((c) => c.id)).size !== v.length
  )
    return null
  return v.map((c) => ({ id: c.id, role: c.role }))
}
export const parseCoupPrivate = (value: unknown): CoupPrivate | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as CoupPrivate,
    hand = cards(raw.hand, 2),
    exchange = cards(raw.exchange, 2)
  return hand &&
    exchange &&
    new Set([...hand, ...exchange].map((c) => c.id)).size === hand.length + exchange.length
    ? { hand, exchange }
    : null
}
export const parseCoupMove = (value: unknown): CoupMove | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.type === 'act')
    return COUP_ACTIONS.includes(raw.action as never) && (raw.target === undefined || text(raw.target))
      ? { type: 'act', action: raw.action as never, ...(raw.target ? { target: raw.target as string } : {}) }
      : null
  if (raw.type === 'pass' || raw.type === 'challenge' || raw.type === 'concede') return { type: raw.type }
  if (raw.type === 'block') return role(raw.role) ? { type: 'block', role: raw.role } : null
  if (raw.type === 'prove' || raw.type === 'lose')
    return text(raw.cardId, 80) && raw.cardId ? { type: raw.type, cardId: raw.cardId } : null
  if (raw.type === 'exchange')
    return Array.isArray(raw.keep) &&
      raw.keep.length > 0 &&
      raw.keep.length <= 2 &&
      raw.keep.every((id) => text(id, 80) && id) &&
      new Set(raw.keep).size === raw.keep.length
      ? { type: 'exchange', keep: [...raw.keep] }
      : null
  return null
}
/** Explicit allow-list: a packet cannot smuggle deck, hands or exchange cards into public state. */
export const parseCoupState = (value: unknown): CoupState | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as CoupState,
    settings = readCoupSettings(raw.settings)
  const phases: CoupPhase[] = [
    'lobby',
    'turn',
    'action-response',
    'block-response',
    'block-challenge',
    'proof',
    'lose-influence',
    'exchange',
    'finished',
  ]
  if (
    !settings ||
    !text(raw.gameId, 80) ||
    !text(raw.controllerIdentity) ||
    !integer(raw.revision) ||
    !phases.includes(raw.phase) ||
    !Array.isArray(raw.players) ||
    raw.players.length > 6 ||
    !text(raw.current) ||
    !integer(raw.turn) ||
    !text(raw.stepId, 80) ||
    !integer(raw.expiresAt) ||
    !integer(raw.treasury, 50) ||
    !integer(raw.deckCount, 15) ||
    !text(raw.winner) ||
    !Array.isArray(raw.events) ||
    raw.events.length > 24
  )
    return null
  const players = raw.players.map((p) => {
    const revealed = p && cards(p.revealed, 2)
    return p &&
      text(p.identity) &&
      p.identity &&
      !['__proto__', 'constructor', 'prototype'].includes(p.identity) &&
      text(p.name, 80) &&
      p.name &&
      integer(p.coins, 50) &&
      integer(p.influence, 2) &&
      revealed &&
      revealed.length + p.influence === 2 &&
      typeof p.away === 'boolean' &&
      (!p.away || !p.influence)
      ? { identity: p.identity, name: p.name, coins: p.coins, influence: p.influence, revealed, away: p.away }
      : null
  })
  if (players.some((p) => !p)) return null
  const valid = players.filter((p) => p !== null),
    ids = new Set(valid.map((p) => p.identity))
  if (
    ids.size !== players.length ||
    valid.reduce((sum, p) => sum + p.coins, raw.treasury) !== 50 ||
    new Set(valid.flatMap((p) => p.revealed.map((c) => c.id))).size !==
      valid.reduce((sum, p) => sum + p.revealed.length, 0)
  )
    return null
  let pending: CoupPending | null = null
  if (raw.pending !== null) {
    const p = raw.pending
    if (
      !p ||
      !ids.has(p.actor) ||
      !COUP_ACTIONS.includes(p.action) ||
      !text(p.target) ||
      (p.target && !ids.has(p.target)) ||
      !text(p.blocker) ||
      (p.blocker && (!ids.has(p.blocker) || p.blocker === p.actor)) ||
      (p.blockRole !== null && !role(p.blockRole)) ||
      !text(p.challenger) ||
      (p.challenger && !ids.has(p.challenger)) ||
      !['action', 'block'].includes(p.claim) ||
      !Array.isArray(p.passes) ||
      p.passes.length > 6 ||
      p.passes.some((id) => !ids.has(id)) ||
      new Set(p.passes).size !== p.passes.length ||
      typeof p.effectApplied !== 'boolean' ||
      (coupActions[p.action].targeted ? !p.target || p.target === p.actor : Boolean(p.target)) ||
      (p.claim === 'block' && (!p.blocker || !p.blockRole))
    )
      return null
    pending = {
      actor: p.actor,
      action: p.action,
      target: p.target,
      blocker: p.blocker,
      blockRole: p.blockRole,
      challenger: p.challenger,
      claim: p.claim,
      passes: [...p.passes],
      effectApplied: p.effectApplied,
    }
  }
  let loss: CoupLoss | null = null
  if (raw.loss !== null) {
    const p = raw.loss
    if (
      !p ||
      !ids.has(p.identity) ||
      !['challenge', 'coup', 'assassination'].includes(p.reason) ||
      !['finish', 'cancel', 'offer-block', 'resolve', 'blocked'].includes(p.then)
    )
      return null
    loss = { identity: p.identity, reason: p.reason, then: p.then }
  }
  const kinds: CoupEvent['kind'][] = [
    'action',
    'block',
    'challenge',
    'proof',
    'loss',
    'exchange',
    'win',
    'leave',
  ]
  const events = raw.events.map((e): CoupEvent | null =>
    e &&
    integer(e.id) &&
    kinds.includes(e.kind) &&
    text(e.actor) &&
    (!e.actor || ids.has(e.actor)) &&
    text(e.target) &&
    (!e.target || ids.has(e.target)) &&
    (e.role === null || role(e.role)) &&
    (e.action === null || COUP_ACTIONS.includes(e.action)) &&
    text(e.text, 240)
      ? {
          id: e.id,
          kind: e.kind,
          actor: e.actor,
          target: e.target,
          role: e.role,
          action: e.action,
          text: e.text,
        }
      : null,
  )
  if (
    events.some((e) => !e) ||
    (raw.phase === 'lobby'
      ? raw.gameId || players.length || raw.turn || pending || loss
      : !raw.gameId || players.length < 2 || !raw.turn || !raw.stepId) ||
    (['lobby', 'finished'].includes(raw.phase) ? raw.current : !ids.has(raw.current)) ||
    (['lobby', 'finished', 'turn'].includes(raw.phase)
      ? pending !== null
      : !pending || pending.actor !== raw.current) ||
    (raw.phase === 'lose-influence' ? !loss : loss !== null) ||
    (raw.winner && (raw.phase !== 'finished' || !ids.has(raw.winner))) ||
    (raw.phase === 'proof' &&
      (!pending?.challenger ||
        !(pending.claim === 'block' ? pending.blockRole : coupActions[pending.action].role)))
  )
    return null
  return {
    gameId: raw.gameId,
    controllerIdentity: raw.controllerIdentity,
    revision: raw.revision,
    phase: raw.phase,
    players: valid,
    current: raw.current,
    turn: raw.turn,
    stepId: raw.stepId,
    expiresAt: raw.expiresAt,
    settings,
    treasury: raw.treasury,
    deckCount: raw.deckCount,
    pending,
    loss,
    winner: raw.winner,
    events: events.filter((e) => e !== null),
  }
}
