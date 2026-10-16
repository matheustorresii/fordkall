import { CODENAMES_WORDS } from './codenamesWords.ts'

export type CodenamesTeam = 'red' | 'blue'
export type CodenamesKind = CodenamesTeam | 'neutral' | 'assassin'
export type CodenamesRole = 'spymaster' | 'operative'
export type CodenamesClueMode = 'single' | 'multiple'
export interface CodenamesPlayer {
  identity: string
  name: string
  team: CodenamesTeam | null
  role: CodenamesRole
  connected: boolean
}
export interface CodenamesCard {
  id: string
  word: string
  revealed: CodenamesKind | null
}
export interface CodenamesClue {
  turn: number
  team: CodenamesTeam
  word: string
  count: number | 'unlimited'
  by: string
  guesses: Array<{ cardId: string; by: string; kind: CodenamesKind }>
}
export interface CodenamesSettings {
  customWords: string[]
  clueMode: CodenamesClueMode
}
export interface CodenamesState {
  gameId: string
  controllerIdentity: string
  revision: number
  phase: 'lobby' | 'clue' | 'guess' | 'finished'
  clueMode: CodenamesClueMode
  players: CodenamesPlayer[]
  board: CodenamesCard[]
  startingTeam: CodenamesTeam
  turnTeam: CodenamesTeam
  turn: number
  stepId: string
  remaining: Record<CodenamesTeam, number>
  clues: CodenamesClue[]
  suggestions: Record<string, string>
  winner: CodenamesTeam | null
  finishReason: 'agents' | 'assassin' | null
  solution: CodenamesKind[]
  events: Array<{ id: number; text: string }>
}
export interface CodenamesEngine {
  state: CodenamesState
  key: CodenamesKind[]
}
export interface CodenamesPrivate {
  key: CodenamesKind[]
}
export type CodenamesMove =
  | { type: 'seat'; team: CodenamesTeam | null; role: CodenamesRole }
  | { type: 'shuffle' }
  | { type: 'clue'; word: string; count: number | 'unlimited' }
  | { type: 'suggest'; cardId: string | null }
  | { type: 'guess'; cardId: string }
  | { type: 'pass' }

export const CODENAMES_MAX_PLAYERS = 12
export const defaultCodenamesSettings: CodenamesSettings = { customWords: [], clueMode: 'single' }
export const codenamesClueLimit = (mode: CodenamesClueMode) => mode === 'multiple' ? 48 : 24
export const codenamesTeamName = (team: CodenamesTeam) => (team === 'red' ? 'Vermelha' : 'Azul')
export const otherCodenamesTeam = (team: CodenamesTeam): CodenamesTeam => (team === 'red' ? 'blue' : 'red')
export const normalizeCodenamesWord = (word: string) =>
  word
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleUpperCase('pt-BR')
export const codenamesWord = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= 24 &&
  /^[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*$/u.test(value)
/** Canonical text is validated before committing, including uppercase expansions such as ß → SS. */
export const readCodenamesClue = (value: unknown, mode: CodenamesClueMode): string | null => {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value) || value.length > 256) return null
  const text = value.trim().normalize('NFC').toLocaleUpperCase('pt-BR').replace(/ +/g, ' ')
  const words = text.split(' ')
  return text.length <= codenamesClueLimit(mode) && (mode === 'multiple' || words.length === 1) && words.every(codenamesWord) ? text : null
}
export const readCodenamesSettings = (value: unknown): CodenamesSettings | null => {
  if (value === undefined) return { ...defaultCodenamesSettings, customWords: [] }
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>, words = raw.customWords, clueMode = raw.clueMode === undefined ? 'single' : raw.clueMode
  if (clueMode !== 'single' && clueMode !== 'multiple') return null
  if (!Array.isArray(words) || words.length > 300 || words.some((w) => !codenamesWord(w))) return null
  const unique = new Map<string, string>()
  for (const word of words as string[])
    unique.set(normalizeCodenamesWord(word), word.toLocaleUpperCase('pt-BR'))
  if (new TextEncoder().encode(JSON.stringify([...unique.values()])).length > 10_000) return null
  return unique.size && unique.size < 25 ? null : { customWords: [...unique.values()], clueMode }
}
export const emptyCodenamesState = (controllerIdentity: string, revision = 0): CodenamesState => ({
  gameId: '',
  controllerIdentity,
  revision,
  phase: 'lobby',
  clueMode: 'single',
  players: [],
  board: [],
  startingTeam: 'red',
  turnTeam: 'red',
  turn: 0,
  stepId: '',
  remaining: { red: 0, blue: 0 },
  clues: [],
  suggestions: {},
  winner: null,
  finishReason: null,
  solution: [],
  events: [],
})
const shuffled = <T>(values: readonly T[], random?: () => number): T[] => {
  const result = [...values]
  const index = (size: number) => {
    if (random) {
      const n = random()
      if (!Number.isFinite(n) || n < 0 || n >= 1) throw new Error('Sorteio inválido.')
      return Math.floor(n * size)
    }
    const limit = 0x100000000 - (0x100000000 % size),
      data = new Uint32Array(1)
    do {
      crypto.getRandomValues(data)
    } while (data[0]! >= limit)
    return data[0]! % size
  }
  for (let i = result.length - 1; i > 0; i--) {
    const at = index(i + 1)
    ;[result[i], result[at]] = [result[at]!, result[i]!]
  }
  return result
}
const copy = (engine: CodenamesEngine): CodenamesEngine => ({
  key: [...engine.key],
  state: {
    ...engine.state,
    players: engine.state.players.map((p) => ({ ...p })),
    board: engine.state.board.map((c) => ({ ...c })),
    remaining: { ...engine.state.remaining },
    clues: engine.state.clues.map((c) => ({ ...c, guesses: c.guesses.map((g) => ({ ...g })) })),
    suggestions: { ...engine.state.suggestions },
    solution: [...engine.state.solution],
    events: [...engine.state.events],
  },
})
const log = (state: CodenamesState, text: string) => {
  // Full clue/guess history is already in `clues`; only recent status messages need broadcasting.
  state.events = [{ id: (state.events.at(-1)?.id ?? 0) + 1, text }]
}
export const codenamesStartError = (state: CodenamesState): string => {
  const selected = state.players.filter((p) => p.team && p.connected)
  if (selected.length < 4) return 'Escolham pelo menos quatro jogadores, dois em cada equipe.'
  if (selected.length > CODENAMES_MAX_PLAYERS)
    return 'A mesa comporta até 12 jogadores; os demais podem assistir.'
  for (const team of ['red', 'blue'] as const) {
    const people = selected.filter((p) => p.team === team)
    if (people.filter((p) => p.role === 'spymaster').length !== 1)
      return `A equipe ${codenamesTeamName(team)} precisa de um mestre.`
    if (!people.some((p) => p.role === 'operative'))
      return `A equipe ${codenamesTeamName(team)} precisa de pelo menos um agente.`
  }
  return ''
}
export const codenamesPauseReason = (state: CodenamesState) => {
  if (state.phase === 'lobby' || state.phase === 'finished') return ''
  for (const team of ['red', 'blue'] as const) {
    const people = state.players.filter((p) => p.team === team && p.connected)
    if (!people.some((p) => p.role === 'spymaster'))
      return `O mestre da equipe ${codenamesTeamName(team)} saiu. Aguardando reconectar.`
    if (!people.some((p) => p.role === 'operative'))
      return `A equipe ${codenamesTeamName(team)} está sem agentes conectados. Aguardando reconectar.`
  }
  return ''
}
export const codenamesCurrentClue = (state: CodenamesState) => {
  const clue = state.clues.at(-1)
  return clue?.turn === state.turn ? clue : null
}
export const codenamesGuessesLeft = (state: CodenamesState): number | null => {
  const clue = codenamesCurrentClue(state)
  return !clue
    ? 0
    : clue.count === 0 || clue.count === 'unlimited'
      ? null
      : Math.max(0, clue.count + 1 - clue.guesses.length)
}
export const codenamesPrivateFor = (engine: CodenamesEngine, identity: string): CodenamesPrivate => ({
  key: engine.state.players.some((p) => p.identity === identity && p.team && p.role === 'spymaster')
    ? [...engine.key]
    : [],
})
export const syncCodenamesMembers = (
  engine: CodenamesEngine,
  members: Array<{ identity: string; name: string }>,
): CodenamesEngine => {
  const next = copy(engine),
    state = next.state
  const connected = new Map(members.map((p) => [p.identity, p]))
  state.players = state.players
    .filter((p) => state.phase !== 'lobby' || connected.has(p.identity))
    .map((p) => ({
      ...p,
      connected: connected.has(p.identity),
      name: connected.get(p.identity)?.name ?? p.name,
    }))
  for (const person of members) {
    if (state.phase !== 'lobby') break // Late arrivals watch without growing the active game's packets.
    if (!state.players.some((p) => p.identity === person.identity) && state.players.length < 32)
      state.players.push({ ...person, team: null, role: 'operative', connected: true })
  }
  const eligible = new Set(
    state.players
      .filter((p) => p.connected && p.team === state.turnTeam && p.role === 'operative')
      .map((p) => p.identity),
  )
  state.suggestions = Object.fromEntries(Object.entries(state.suggestions).filter(([id]) => eligible.has(id)))
  return next
}
export const createCodenamesMatch = (
  lobby: CodenamesState,
  settings: CodenamesSettings = defaultCodenamesSettings,
  random?: () => number,
): CodenamesEngine => {
  if (!['lobby', 'finished'].includes(lobby.phase)) throw new Error('Já existe uma partida em andamento.')
  const setupError = codenamesStartError(lobby)
  if (setupError) throw new Error(setupError)
  const valid = readCodenamesSettings(settings)
  if (!valid) throw new Error('Use de 25 a 300 palavras diferentes, de até 24 caracteres, ou o banco padrão.')
  const pool = valid.customWords.length
    ? valid.customWords
    : [...new Map(CODENAMES_WORDS.map((word) => [normalizeCodenamesWord(word), word])).values()]
  const startingTeam = shuffled<CodenamesTeam>(['red', 'blue'], random)[0]!
  const key = shuffled<CodenamesKind>(
    [
      ...Array<CodenamesTeam>(9).fill(startingTeam),
      ...Array<CodenamesTeam>(8).fill(otherCodenamesTeam(startingTeam)),
      ...Array<'neutral'>(7).fill('neutral'),
      'assassin',
    ],
    random,
  )
  const state: CodenamesState = {
    ...emptyCodenamesState(lobby.controllerIdentity, lobby.revision),
    gameId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    phase: 'clue',
    clueMode: valid.clueMode,
    players: lobby.players.filter((p) => p.team && p.connected).map((p) => ({ ...p })),
    board: shuffled(pool, random)
      .slice(0, 25)
      .map((word, i) => ({ id: `word-${i}`, word, revealed: null })),
    startingTeam,
    turnTeam: startingTeam,
    turn: 1,
    remaining: { red: startingTeam === 'red' ? 9 : 8, blue: startingTeam === 'blue' ? 9 : 8 },
  }
  log(state, `A equipe ${codenamesTeamName(startingTeam)} começa. Seu mestre dá a primeira pista.`)
  return { state, key }
}
const endTurn = (state: CodenamesState) => {
  state.turnTeam = otherCodenamesTeam(state.turnTeam)
  state.turn += 1
  state.phase = 'clue'
  state.suggestions = {}
}
const finish = (engine: CodenamesEngine, winner: CodenamesTeam, reason: 'agents' | 'assassin') => {
  engine.state.phase = 'finished'
  engine.state.winner = winner
  engine.state.finishReason = reason
  engine.state.solution = [...engine.key]
  engine.state.suggestions = {}
}
export const applyCodenamesMove = (
  engine: CodenamesEngine,
  identity: string,
  move: CodenamesMove,
): CodenamesEngine => {
  const next = copy(engine),
    state = next.state,
    player = state.players.find((p) => p.identity === identity && p.connected)
  if (!player) throw new Error('Você não está nesta mesa.')
  if (move.type === 'seat' || move.type === 'shuffle') {
    if (state.phase !== 'lobby') throw new Error('As equipes e os papéis não podem mudar durante a partida.')
    if (move.type === 'shuffle') {
      const people = state.players.filter((p) => p.connected)
      if (people.length < 4 || people.length > CODENAMES_MAX_PLAYERS)
        throw new Error('Para sortear, a sala deve ter de 4 a 12 pessoas.')
      const order = shuffled(people.map((p) => p.identity))
      state.players = state.players.map((p) => {
        const i = order.indexOf(p.identity)
        return i < 0
          ? p
          : { ...p, team: i % 2 === 0 ? 'red' : 'blue', role: i < 2 ? 'spymaster' : 'operative' }
      })
    } else {
      if (move.team !== null && !['red', 'blue'].includes(move.team)) throw new Error('Equipe inválida.')
      if (!['operative', 'spymaster'].includes(move.role)) throw new Error('Papel inválido.')
      if (
        move.team &&
        move.role === 'spymaster' &&
        state.players.some((p) => p.identity !== identity && p.team === move.team && p.role === 'spymaster')
      )
        throw new Error('Essa equipe já tem um mestre.')
      if (move.team && !player.team && state.players.filter((p) => p.team).length >= CODENAMES_MAX_PLAYERS)
        throw new Error('A mesa está cheia. Você pode assistir.')
      player.team = move.team
      player.role = move.team ? move.role : 'operative'
    }
    return next
  }
  if (!['clue', 'guess'].includes(state.phase) || !player.team)
    throw new Error('Você está assistindo à partida.')
  const pause = codenamesPauseReason(state)
  if (pause) throw new Error(pause)
  if (player.team !== state.turnTeam) throw new Error('Aguarde a vez da sua equipe.')
  if (move.type === 'clue') {
    if (state.phase !== 'clue' || player.role !== 'spymaster')
      throw new Error('Somente o mestre da vez pode enviar a pista.')
    const word = readCodenamesClue(move.word, state.clueMode)
    if (!word) throw new Error(state.clueMode === 'multiple'
      ? 'Use uma palavra ou frase de até 48 caracteres, com até 24 por palavra, sem pontuação extra.'
      : 'Esta partida usa pistas de uma única palavra, com até 24 caracteres.')
    const normalized = new Set(word.split(/[ '’-]/).map(normalizeCodenamesWord))
    if (
      state.board.some(
        (c) =>
          !c.revealed &&
          (normalized.has(normalizeCodenamesWord(c.word)) ||
            c.word.split(/['’-]/).some((part) => normalized.has(normalizeCodenamesWord(part)))),
      )
    )
      throw new Error(
        'A pista não pode ser uma palavra que ainda está na mesa, nem parte de uma palavra composta.',
      )
    if (move.count !== 'unlimited' && (!Number.isSafeInteger(move.count) || move.count < 0 || move.count > 9))
      throw new Error('Escolha um número de 0 a 9 ou ilimitado.')
    state.clues.push({
      turn: state.turn,
      team: player.team,
      word,
      count: move.count,
      by: identity,
      guesses: [],
    })
    state.phase = 'guess'
    state.stepId = crypto.randomUUID()
    log(
      state,
      `${player.name} deu a pista ${word.toLocaleUpperCase('pt-BR')} · ${move.count === 'unlimited' ? '∞' : move.count}.`,
    )
    return next
  }
  if (state.phase !== 'guess' || player.role !== 'operative')
    throw new Error('Somente os agentes da vez podem escolher palavras.')
  const clue = codenamesCurrentClue(state)
  if (!clue) throw new Error('Aguarde a pista do mestre.')
  if (move.type === 'pass') {
    if (!clue.guesses.length)
      throw new Error('A equipe precisa arriscar pelo menos um palpite antes de encerrar.')
    endTurn(state)
    state.stepId = crypto.randomUUID()
    log(state, `${player.name} encerrou os palpites. Vez da equipe ${codenamesTeamName(state.turnTeam)}.`)
    return next
  }
  if (move.type === 'suggest' && move.cardId === null) {
    delete state.suggestions[identity]
    return next
  }
  const index = state.board.findIndex((c) => c.id === move.cardId)
  const card = state.board[index]
  if (!card || card.revealed) throw new Error('Essa palavra já foi revelada ou não está nesta mesa.')
  if (move.type === 'suggest') {
    state.suggestions = { ...state.suggestions, [identity]: card.id }
    return next
  }
  const kind = next.key[index]
  if (!kind) throw new Error('A chave secreta não está disponível. Iniciem outra partida.')
  card.revealed = kind
  clue.guesses.push({ cardId: card.id, by: identity, kind })
  state.suggestions = {}
  state.stepId = crypto.randomUUID()
  if (kind === 'red' || kind === 'blue') state.remaining[kind] -= 1
  if (kind === 'assassin') {
    finish(next, otherCodenamesTeam(player.team), 'assassin')
    log(
      state,
      `${player.name} revelou ${card.word}: assassino. A equipe ${codenamesTeamName(state.winner!)} venceu.`,
    )
  } else if ((kind === 'red' || kind === 'blue') && state.remaining[kind] === 0) {
    finish(next, kind, 'agents')
    log(
      state,
      `${player.name} revelou ${card.word}. Todos os agentes da equipe ${codenamesTeamName(kind)} foram encontrados!`,
    )
  } else {
    const correct = kind === player.team
    const turnEnded = !correct || codenamesGuessesLeft(state) === 0
    if (turnEnded) endTurn(state)
    log(
      state,
      `${player.name} revelou ${card.word}: ${kind === 'neutral' ? 'civil' : `equipe ${codenamesTeamName(kind)}`}.${turnEnded ? ` Vez da equipe ${codenamesTeamName(state.turnTeam)}.` : ''}`,
    )
  }
  return next
}
