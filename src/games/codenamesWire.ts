import { codenamesWord, normalizeCodenamesWord, readCodenamesClue } from './codenames.ts'
import type {
  CodenamesClue,
  CodenamesKind,
  CodenamesMove,
  CodenamesPlayer,
  CodenamesPrivate,
  CodenamesState,
  CodenamesTeam,
} from './codenames.ts'

const record = (v: unknown): v is Record<string, unknown> =>
  Boolean(v && typeof v === 'object' && !Array.isArray(v))
const text = (v: unknown, max = 128): v is string =>
  typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v)
const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
  Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max
const team = (v: unknown): v is CodenamesTeam => v === 'red' || v === 'blue'
const kind = (v: unknown): v is CodenamesKind => team(v) || v === 'neutral' || v === 'assassin'
const clueCount = (v: unknown): v is number | 'unlimited' => v === 'unlimited' || integer(v, 9)
const readKey = (v: unknown): CodenamesKind[] | null => {
  if (!Array.isArray(v) || v.length !== 25 || !v.every(kind)) return null
  const red = v.filter((k) => k === 'red').length,
    blue = v.filter((k) => k === 'blue').length
  return [red, blue].sort().join() === '8,9' &&
    v.filter((k) => k === 'neutral').length === 7 &&
    v.filter((k) => k === 'assassin').length === 1
    ? [...v]
    : null
}
export const parseCodenamesPrivate = (value: unknown): CodenamesPrivate | null => {
  if (!record(value) || !Array.isArray(value.key)) return null
  if (!value.key.length) return { key: [] }
  const key = readKey(value.key)
  return key ? { key } : null
}
export const parseCodenamesMove = (value: unknown): CodenamesMove | null => {
  if (!record(value)) return null
  if (value.type === 'shuffle' || value.type === 'pass') return { type: value.type }
  if (
    value.type === 'seat' &&
    (value.team === null || team(value.team)) &&
    ['spymaster', 'operative'].includes(value.role as string)
  )
    return { type: 'seat', team: value.team, role: value.role as CodenamesPlayer['role'] }
  if (value.type === 'clue' && text(value.word, 256) && clueCount(value.count))
    return { type: 'clue', word: value.word, count: value.count }
  if (
    value.type === 'suggest' &&
    (value.cardId === null || (text(value.cardId, 40) && value.cardId.length > 0))
  )
    return { type: 'suggest', cardId: value.cardId }
  if (value.type === 'guess' && text(value.cardId, 40) && value.cardId.length > 0)
    return { type: 'guess', cardId: value.cardId }
  return null
}
export const parseCodenamesState = (value: unknown): CodenamesState | null => {
  if (!record(value)) return null
  const s = value
  const clueMode = s.clueMode === undefined ? 'single' : s.clueMode
  if (clueMode !== 'single' && clueMode !== 'multiple') return null
  if (
    !text(s.gameId) ||
    !text(s.controllerIdentity) ||
    !s.controllerIdentity ||
    !integer(s.revision) ||
    !['lobby', 'clue', 'guess', 'finished'].includes(s.phase as string) ||
    !text(s.stepId) ||
    !team(s.startingTeam) ||
    !team(s.turnTeam) ||
    !integer(s.turn, 40) ||
    !record(s.remaining) ||
    !integer(s.remaining.red, 9) ||
    !integer(s.remaining.blue, 9) ||
    !Array.isArray(s.players) ||
    s.players.length > 32 ||
    !Array.isArray(s.board) ||
    !Array.isArray(s.clues) ||
    s.clues.length > 40 ||
    !record(s.suggestions) ||
    !Array.isArray(s.solution) ||
    !Array.isArray(s.events) ||
    s.events.length > 1
  )
    return null
  const players: CodenamesPlayer[] = []
  for (const p of s.players) {
    if (
      !record(p) ||
      !text(p.identity) ||
      !p.identity ||
      !text(p.name, 80) ||
      !p.name ||
      !(p.team === null || team(p.team)) ||
      !['spymaster', 'operative'].includes(p.role as string) ||
      typeof p.connected !== 'boolean'
    )
      return null
    players.push({
      identity: p.identity,
      name: p.name,
      team: p.team,
      role: p.role as CodenamesPlayer['role'],
      connected: p.connected,
    })
  }
  const identities = new Set(players.map((p) => p.identity))
  if (identities.size !== players.length || players.filter((p) => p.team).length > 12) return null
  for (const color of ['red', 'blue'])
    if (players.filter((p) => p.team === color && p.role === 'spymaster').length > 1) return null
  const board: CodenamesState['board'] = []
  for (const c of s.board) {
    if (
      !record(c) ||
      !text(c.id, 40) ||
      !c.id ||
      !codenamesWord(c.word) ||
      !(c.revealed === null || kind(c.revealed))
    )
      return null
    board.push({ id: c.id, word: c.word, revealed: c.revealed })
  }
  const cardIds = new Set(board.map((c) => c.id))
  if (
    cardIds.size !== board.length ||
    new Set(board.map((c) => normalizeCodenamesWord(c.word))).size !== board.length
  )
    return null
  const clues: CodenamesClue[] = [],
    guessed = new Set<string>()
  for (const c of s.clues) {
    if (
      !record(c) ||
      !integer(c.turn, s.turn) ||
      !c.turn ||
      !team(c.team) ||
      (typeof c.word !== 'string' || readCodenamesClue(c.word, clueMode) !== c.word) ||
      !clueCount(c.count) ||
      !text(c.by) ||
      !identities.has(c.by) ||
      !Array.isArray(c.guesses) ||
      c.guesses.length > 25 ||
      (clues.at(-1)?.turn ?? 0) >= c.turn
    )
      return null
    const guesses: CodenamesClue['guesses'] = []
    for (const g of c.guesses) {
      if (
        !record(g) ||
        !text(g.cardId, 40) ||
        !cardIds.has(g.cardId) ||
        guessed.has(g.cardId) ||
        !text(g.by) ||
        !identities.has(g.by) ||
        !kind(g.kind) ||
        board.find((card) => card.id === g.cardId)?.revealed !== g.kind
      )
        return null
      guessed.add(g.cardId)
      guesses.push({ cardId: g.cardId, by: g.by, kind: g.kind })
    }
    clues.push({ turn: c.turn, team: c.team, word: c.word, count: c.count, by: c.by, guesses })
  }
  const suggestions: Record<string, string> = Object.fromEntries(
    Object.entries(s.suggestions).filter(([id, cardId]) => {
      const p = players.find((person) => person.identity === id)
      return (
        s.phase === 'guess' &&
        p &&
        p.team === s.turnTeam &&
        p.role === 'operative' &&
        p.connected &&
        typeof cardId === 'string' &&
        board.some((c) => c.id === cardId && c.revealed === null)
      )
    }),
  ) as Record<string, string>
  const events: CodenamesState['events'] = []
  for (const event of s.events) {
    if (!record(event) || !integer(event.id) || !text(event.text, 240)) return null
    events.push({ id: event.id, text: event.text })
  }
  const lobby = s.phase === 'lobby',
    finished = s.phase === 'finished'
  const solution = finished ? readKey(s.solution) : []
  if (
    !solution ||
    (!finished && s.solution.length) ||
    (finished
      ? !team(s.winner) || !['agents', 'assassin'].includes(s.finishReason as string)
      : s.winner !== null || s.finishReason !== null) ||
    (lobby
      ? s.gameId !== '' || s.stepId !== '' || s.turn !== 0 || board.length !== 0 || clues.length !== 0
      : !s.gameId || !s.stepId || s.turn < 1 || board.length !== 25) ||
    (s.phase === 'guess' && clues.at(-1)?.turn !== s.turn)
  )
    return null
  if (!lobby) {
    if (board.filter((c) => c.revealed).length !== guessed.size) return null
    for (const color of ['red', 'blue'] as const) {
      if (
        s.remaining[color] !==
        (s.startingTeam === color ? 9 : 8) - board.filter((c) => c.revealed === color).length
      )
        return null
    }
    if (finished && solution.some((k, i) => board[i]!.revealed && board[i]!.revealed !== k)) return null
  }
  return {
    gameId: s.gameId,
    controllerIdentity: s.controllerIdentity,
    revision: s.revision,
    phase: s.phase as CodenamesState['phase'],
    clueMode,
    stepId: s.stepId,
    turn: s.turn,
    players,
    board,
    startingTeam: s.startingTeam,
    turnTeam: s.turnTeam,
    remaining: { red: s.remaining.red, blue: s.remaining.blue },
    clues,
    suggestions,
    winner: s.winner as CodenamesState['winner'],
    finishReason: s.finishReason as CodenamesState['finishReason'],
    solution,
    events,
  }
}
