import {
  ODIN_CLANS,
  odinSameGroup,
  odinValue,
  readOdinSettings,
} from './odin.ts'
import type {
  OdinCard,
  OdinMove,
  OdinPlay,
  OdinPrivate,
  OdinResult,
  OdinState,
} from './odin.ts'
const text = (value: unknown, max = 128): value is string =>
  typeof value === 'string' &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value)
const integer = (
  value: unknown,
  max = Number.MAX_SAFE_INTEGER,
): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max
const cardId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^(leaf|tide|sun|ember|moon|bloom)-[1-9]$/.test(value)
export function parseOdinCards(value: unknown): OdinCard[] | null {
  if (
    !Array.isArray(value) ||
    value.length > 9 ||
    value.some(
      (c) =>
        !c ||
        !ODIN_CLANS.includes(c.clan) ||
        !integer(c.value, 9) ||
        c.value < 1 ||
        c.id !== `${c.clan}-${c.value}`,
    ) ||
    new Set(value.map((c) => c.id)).size !== value.length
  )
    return null
  return value.map((c) => ({ id: c.id, clan: c.clan, value: c.value }))
}
export function parseOdinPrivate(value: unknown): OdinPrivate | null {
  if (!value || typeof value !== 'object') return null
  const hand = parseOdinCards((value as OdinPrivate).hand)
  return hand ? { hand } : null
}
export function parseOdinMove(value: unknown): OdinMove | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.type === 'pass') return { type: 'pass' }
  if (
    raw.type !== 'play' ||
    !Array.isArray(raw.cardIds) ||
    !raw.cardIds.length ||
    raw.cardIds.length > 9 ||
    !raw.cardIds.every(cardId) ||
    new Set(raw.cardIds).size !== raw.cardIds.length ||
    (raw.takeId !== undefined && !cardId(raw.takeId))
  )
    return null
  return {
    type: 'play',
    cardIds: [...raw.cardIds],
    ...(raw.takeId ? { takeId: raw.takeId as string } : {}),
  }
}
/** Public allow-list. No packet can publish the engine's hands, undealt pack or private discard. */
export function parseOdinState(value: unknown): OdinState | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as OdinState,
    settings = readOdinSettings(raw.settings),
    center = parseOdinCards(raw.center)
  if (
    !settings ||
    !center ||
    !text(raw.gameId, 80) ||
    !text(raw.controllerIdentity) ||
    !integer(raw.revision) ||
    !['lobby', 'playing', 'hand-result', 'finished'].includes(raw.phase) ||
    !Array.isArray(raw.players) ||
    raw.players.length > 6 ||
    !text(raw.current) ||
    !text(raw.starter) ||
    !text(raw.lastPlayer) ||
    !text(raw.stepId, 80) ||
    !integer(raw.handNumber, 1000) ||
    !integer(raw.roundNumber) ||
    !integer(raw.turnExpiresAt) ||
    !integer(raw.transitionAt) ||
    !integer(raw.discardedCount, 54) ||
    !integer(raw.asideCount, 54) ||
    ![36, 54].includes(raw.deckSize) ||
    !text(raw.lastEvent, 512) ||
    !Array.isArray(raw.passes) ||
    !Array.isArray(raw.winners)
  )
    return null
  const players = raw.players.map((p) =>
    p &&
    text(p.identity) &&
    p.identity &&
    !['__proto__', 'constructor', 'prototype'].includes(p.identity) &&
    text(p.name, 80) &&
    p.name &&
    integer(p.cardsRemaining, 9) &&
    integer(p.score, 1000) &&
    typeof p.away === 'boolean' &&
    (!p.away || !p.cardsRemaining)
      ? {
          identity: p.identity,
          name: p.name,
          cardsRemaining: p.cardsRemaining,
          score: p.score,
          away: p.away,
        }
      : null,
  )
  if (players.some((p) => !p)) return null
  const valid = players.filter((p) => p !== null),
    ids = new Set(valid.map((p) => p.identity)),
    active = valid.filter((p) => !p.away)
  if (
    ids.size !== players.length ||
    raw.passes.length > 6 ||
    raw.winners.length > 6 ||
    [raw.passes, raw.winners].some(
      (list) =>
        list.some((id) => !ids.has(id)) || new Set(list).size !== list.length,
    ) ||
    (center.length && !odinSameGroup(center))
  )
    return null
  let lastPlay: OdinPlay | null = null
  if (raw.lastPlay !== null) {
    const p = raw.lastPlay,
      cards = p && parseOdinCards(p.cards),
      taken = p?.taken === null ? [] : p && parseOdinCards([p.taken])
    if (
      !p ||
      !text(p.id, 80) ||
      !p.id ||
      !ids.has(p.actor) ||
      !cards?.length ||
      !odinSameGroup(cards) ||
      !taken ||
      taken.some((card) => cards.some((c) => c.id === card.id)) ||
      p.value !== odinValue(cards)
    )
      return null
    lastPlay = {
      id: p.id,
      actor: p.actor,
      cards,
      taken: taken[0] || null,
      value: p.value,
    }
  }
  let result: OdinResult | null = null
  if (raw.result !== null) {
    const r = raw.result
    if (
      !r ||
      !ids.has(r.winner) ||
      !Array.isArray(r.entries) ||
      r.entries.length < 2 ||
      r.entries.length > 6 ||
      r.entries.some(
        (p) =>
          !p ||
          !ids.has(p.identity) ||
          !integer(p.penalty, 9) ||
          !integer(p.total, 1000) ||
          p.total !== valid.find((v) => v.identity === p.identity)!.score,
      ) ||
      new Set(r.entries.map((p) => p.identity)).size !== r.entries.length ||
      !r.entries.some((p) => p.identity === r.winner && p.penalty === 0)
    )
      return null
    result = {
      winner: r.winner,
      entries: r.entries.map((p) => ({
        identity: p.identity,
        penalty: p.penalty,
        total: p.total,
      })),
    }
  }
  if (
    !['', 'points', 'single-hand', 'not-enough-players'].includes(
      raw.finishReason,
    )
  )
    return null
  if (raw.phase === 'lobby') {
    if (
      raw.gameId ||
      valid.length ||
      center.length ||
      raw.current ||
      raw.starter ||
      raw.handNumber ||
      raw.roundNumber ||
      raw.stepId ||
      raw.turnExpiresAt ||
      raw.transitionAt ||
      raw.lastPlayer ||
      raw.passes.length ||
      raw.winners.length ||
      raw.discardedCount ||
      raw.asideCount ||
      result ||
      lastPlay ||
      raw.finishReason
    )
      return null
  } else {
    if (
      !raw.gameId ||
      valid.length < 2 ||
      !raw.handNumber ||
      !raw.roundNumber ||
      !raw.stepId ||
      !ids.has(raw.starter) ||
      valid.reduce(
        (sum, p) => sum + p.cardsRemaining,
        center.length + raw.discardedCount + raw.asideCount,
      ) !== raw.deckSize
    )
      return null
    if (
      raw.deckSize !==
        (valid.length === 2 && settings.duelFourClans ? 36 : 54) ||
      (raw.deckSize === 36 &&
        [
          ...center,
          ...(lastPlay?.cards || []),
          ...(lastPlay?.taken ? [lastPlay.taken] : []),
        ].some((c) => c.clan === 'moon' || c.clan === 'bloom'))
    )
      return null
    if (raw.phase === 'playing') {
      if (
        !active.some(
          (p) => p.identity === raw.current && p.cardsRemaining > 0,
        ) ||
        active.length < 2 ||
        result ||
        raw.winners.length ||
        raw.finishReason ||
        raw.transitionAt ||
        Boolean(raw.turnExpiresAt) !== Boolean(settings.turnSeconds)
      )
        return null
    } else if (raw.current || raw.turnExpiresAt) return null
    if (
      center.length
        ? !ids.has(raw.lastPlayer)
        : raw.lastPlayer || raw.passes.length
    )
      return null
    if (
      raw.phase === 'hand-result'
        ? !result || !raw.transitionAt || raw.winners.length || raw.finishReason
        : raw.transitionAt
    )
      return null
    if (raw.phase === 'finished') {
      if (!raw.finishReason) return null
      if (raw.finishReason === 'not-enough-players') {
        if (active.length > 1 || raw.winners.length) return null
      } else {
        if (!result || !raw.winners.length || active.length < 2) return null
        const low = Math.min(...active.map((p) => p.score)),
          winners = active.filter((p) => p.score === low).map((p) => p.identity)
        if (
          winners.length !== raw.winners.length ||
          winners.some((id) => !raw.winners.includes(id)) ||
          (raw.finishReason === 'points' &&
            !active.some((p) => p.score >= settings.pointLimit))
        )
          return null
      }
    }
  }
  return {
    gameId: raw.gameId,
    controllerIdentity: raw.controllerIdentity,
    revision: raw.revision,
    phase: raw.phase,
    settings,
    players: valid,
    current: raw.current,
    starter: raw.starter,
    handNumber: raw.handNumber,
    roundNumber: raw.roundNumber,
    stepId: raw.stepId,
    turnExpiresAt: raw.turnExpiresAt,
    transitionAt: raw.transitionAt,
    center,
    lastPlayer: raw.lastPlayer,
    passes: [...raw.passes],
    discardedCount: raw.discardedCount,
    asideCount: raw.asideCount,
    deckSize: raw.deckSize,
    lastPlay,
    result,
    winners: [...raw.winners],
    finishReason: raw.finishReason,
    lastEvent: raw.lastEvent,
  }
}
