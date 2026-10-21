export interface PartyMember {
  identity: string
  name: string
}
export const majority = (count: number) => Math.floor(count / 2) + 1
export const cleanWord = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
const id = () => crypto.randomUUID()
const randomIndex = (n: number) => {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return a[0]! % n
}
const pick = <T>(items: T[]) => items[randomIndex(items.length)]!
const safeText = (v: unknown, max = 100): v is string =>
  typeof v === 'string' && v.length <= max
export const WORD_PAIRS: Record<string, [string, string][]> = {
  'Cultura pop': [
    ['Homem de Ferro', 'Homem-Aranha'],
    ['Aang', 'Korra'],
    ['Batman', 'Superman'],
    ['Barbie', 'Polly'],
    ['Harry Potter', 'Percy Jackson'],
    ['Mario', 'Sonic'],
    ['Pikachu', 'Charmander'],
    ['Shrek', 'Fiona'],
    ['Darth Vader', 'Kylo Ren'],
    ['Goku', 'Naruto'],
  ],
  Comidas: [
    ['Pizza', 'Lasanha'],
    ['Kiwi', 'Morango'],
    ['Hambúrguer', 'Cachorro-quente'],
    ['Coxinha', 'Pastel'],
    ['Sorvete', 'Açaí'],
    ['Café', 'Chocolate quente'],
    ['Sushi', 'Sashimi'],
    ['Brigadeiro', 'Beijinho'],
  ],
  Cotidiano: [
    ['Praia', 'Piscina'],
    ['Cinema', 'Teatro'],
    ['Bicicleta', 'Patinete'],
    ['Avião', 'Helicóptero'],
    ['Violão', 'Guitarra'],
    ['Montanha', 'Vulcão'],
    ['Gato', 'Coelho'],
    ['Chuva', 'Neve'],
  ],
}
export interface ImpostorSettings {
  mode: 'impostor' | 'related'
  theme: string
  customPairs: string
}
export const defaultImpostorSettings: ImpostorSettings = {
  mode: 'related',
  theme: 'Cultura pop',
  customPairs: '',
}
export interface ImpostorSecret {
  word: string
}
export interface ImpostorState {
  gameId: string
  controllerIdentity: string
  revision: number
  stepId: string
  phase: 'lobby' | 'talk' | 'vote' | 'result'
  players: PartyMember[]
  theme: string
  mode: ImpostorSettings['mode']
  requests: string[]
  voted: string[]
  result: null | {
    impostor: string
    word: string
    otherWord: string
    accused: string[]
    counts: Record<string, number>
    caught: boolean
    reason: string
  }
}
export interface ImpostorEngine {
  state: ImpostorState
  secrets: Record<string, ImpostorSecret>
  impostor: string
  word: string
  otherWord: string
  ballots: Record<string, string>
}
export const emptyImpostorState = (
  controllerIdentity: string,
  revision = 0,
): ImpostorState => ({
  gameId: '',
  controllerIdentity,
  revision,
  stepId: '',
  phase: 'lobby',
  players: [],
  theme: '',
  mode: 'related',
  requests: [],
  voted: [],
  result: null,
})
export const readImpostorSettings = (v: unknown): ImpostorSettings | null => {
  if (!v || typeof v !== 'object') return null
  const s = v as ImpostorSettings
  return ['impostor', 'related'].includes(s.mode) &&
    safeText(s.theme, 50) &&
    safeText(s.customPairs, 2000)
    ? { ...s }
    : null
}
export const createImpostor = (
  controller: string,
  players: PartyMember[],
  settings: ImpostorSettings,
): ImpostorEngine => {
  if (players.length < 3 || players.length > 12)
    throw Error('O Impostor precisa de 3 a 12 pessoas.')
  const custom = settings.customPairs
    .split('\n')
    .map((l) => l.split('|').map((s) => s.trim()))
    .filter(
      (p) => p.length === 2 && p.every((s) => s.length > 0 && s.length <= 60),
    ) as [string, string][]
  if (settings.customPairs.trim() && !custom.length)
    throw Error('Escreva um par por linha: Homem de Ferro | Homem-Aranha.')
  const pair = pick(
    custom.length
      ? custom
      : WORD_PAIRS[settings.theme] || WORD_PAIRS['Cultura pop']!,
  )
  const [word, otherWord] = randomIndex(2) ? pair : [pair[1], pair[0]]
  const impostor = pick(players).identity
  return {
    state: {
      ...emptyImpostorState(controller),
      gameId: id(),
      stepId: id(),
      phase: 'talk',
      players,
      theme: custom.length ? 'Personalizado' : settings.theme,
      mode: settings.mode,
    },
    impostor,
    word,
    otherWord,
    ballots: {},
    secrets: Object.fromEntries(
      players.map((p) => [
        p.identity,
        {
          word:
            p.identity === impostor
              ? settings.mode === 'impostor'
                ? 'IMPOSTOR'
                : otherWord
              : word,
        },
      ]),
    ),
  }
}
const finishImpostor = (e: ImpostorEngine, reason = '') => {
  const counts: Record<string, number> = {}
  Object.values(e.ballots).forEach((v) => {
    counts[v] = (counts[v] || 0) + 1
  })
  const max = Math.max(0, ...Object.values(counts)),
    accused = Object.keys(counts).filter((k) => counts[k] === max)
  e.state.phase = 'result'
  e.state.stepId = id()
  e.state.result = {
    impostor: e.impostor,
    word: e.word,
    otherWord: e.otherWord,
    accused,
    counts,
    caught: accused.length === 1 && accused[0] === e.impostor,
    reason,
  }
}
export const moveImpostor = (
  original: ImpostorEngine,
  sender: string,
  move: { type: 'request-vote' } | { type: 'vote'; target: string },
): ImpostorEngine => {
  const e = structuredClone(original),
    s = e.state
  if (!s.players.some((p) => p.identity === sender))
    throw Error('Você está só assistindo.')
  if (move.type === 'request-vote') {
    if (s.phase !== 'talk') throw Error('A votação já começou.')
    s.requests = s.requests.includes(sender)
      ? s.requests.filter((x) => x !== sender)
      : [...s.requests, sender]
    if (s.requests.length >= majority(s.players.length)) {
      s.phase = 'vote'
      s.stepId = id()
    }
  } else {
    if (
      s.phase !== 'vote' ||
      !s.players.some((p) => p.identity === move.target)
    )
      throw Error('Escolha uma pessoa da rodada.')
    e.ballots[sender] = move.target
    s.voted = Object.keys(e.ballots)
    if (s.voted.length === s.players.length) finishImpostor(e)
  }
  return e
}
export const syncImpostor = (
  original: ImpostorEngine,
  members: PartyMember[],
) => {
  const e = structuredClone(original),
    connected = new Set(members.map((p) => p.identity))
  e.state.players = e.state.players.filter((p) => connected.has(p.identity))
  e.state.requests = e.state.requests.filter((x) => connected.has(x))
  e.ballots = Object.fromEntries(
    Object.entries(e.ballots).filter(
      ([v, t]) => connected.has(v) && connected.has(t),
    ),
  )
  e.state.voted = Object.keys(e.ballots)
  if (e.state.phase === 'talk' || e.state.phase === 'vote') {
    if (!connected.has(e.impostor) || e.state.players.length < 3)
      finishImpostor(e, 'A rodada terminou porque um participante saiu.')
    else if (
      e.state.phase === 'talk' &&
      e.state.requests.length >= majority(e.state.players.length)
    ) {
      e.state.phase = 'vote'
      e.state.stepId = id()
    } else if (
      e.state.phase === 'vote' &&
      e.state.voted.length === e.state.players.length
    )
      finishImpostor(e)
  }
  return e
}

export interface GarticSettings {
  mode: 'classic' | 'teams' | 'telephone'
  seconds: number
  rounds: number
  customWords: string
}
export const defaultGarticSettings: GarticSettings = {
  mode: 'classic',
  seconds: 90,
  rounds: 2,
  customWords: '',
}
export interface GarticSecret {
  word: string
  choices: string[]
}
export interface GarticState {
  gameId: string
  controllerIdentity: string
  revision: number
  stepId: string
  phase:
    | 'lobby'
    | 'prompt'
    | 'choosing'
    | 'drawing'
    | 'guessing'
    | 'roundEnd'
    | 'finished'
  players: (PartyMember & { score: number; team: number })[]
  settings: GarticSettings
  turn: number
  actor: string
  boardId: string
  boardArtist: string
  deadline: number
  wordShape: string
  guessed: string[]
  messages: { name: string; text: string; correct: boolean }[]
  reveal: string
  album: {
    actor: string
    kind: 'text' | 'drawing'
    text: string
    boardId: string
  }[]
  resultAlbum: {
    actor: string
    kind: 'text' | 'drawing'
    text: string
    boardId: string
  }[]
}
export interface GarticEngine {
  state: GarticState
  word: string
  choices: string[]
  secrets: Record<string, GarticSecret>
  story: GarticState['album']
}
export const emptyGarticState = (
  controllerIdentity: string,
  revision = 0,
): GarticState => ({
  gameId: '',
  controllerIdentity,
  revision,
  stepId: '',
  phase: 'lobby',
  players: [],
  settings: defaultGarticSettings,
  turn: 0,
  actor: '',
  boardId: '',
  boardArtist: '',
  deadline: 0,
  wordShape: '',
  guessed: [],
  messages: [],
  reveal: '',
  album: [],
  resultAlbum: [],
})
export const readGarticSettings = (v: unknown): GarticSettings | null => {
  if (!v || typeof v !== 'object') return null
  const s = v as GarticSettings
  return ['classic', 'teams', 'telephone'].includes(s.mode) &&
    [30, 60, 90, 120, 180].includes(s.seconds) &&
    Number.isInteger(s.rounds) &&
    s.rounds >= 1 &&
    s.rounds <= 5 &&
    safeText(s.customWords, 2000)
    ? { ...s }
    : null
}
const words = (e: GarticEngine) =>
  e.state.settings.customWords
    .split(/[\n,]/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0 && w.length <= 60)
const prepareTurn = (e: GarticEngine, now: number) => {
  const s = e.state
  s.stepId = id()
  s.actor = s.players[s.turn % s.players.length]!.identity
  s.guessed = []
  s.messages = []
  s.reveal = ''
  s.deadline = now + 30_000
  if (s.settings.mode === 'telephone') {
    s.phase = s.turn === 0 ? 'prompt' : s.turn % 2 ? 'drawing' : 'guessing'
    s.deadline = now + s.settings.seconds * 1000
    if (s.phase === 'drawing') {
      s.boardId = id()
      s.boardArtist = s.actor
      e.word = e.story.at(-1)?.text || ''
    }
    if (s.turn === 0) s.boardId = id()
    e.secrets = Object.fromEntries(
      s.players.map((p) => [
        p.identity,
        {
          word: p.identity === s.actor && s.phase === 'drawing' ? e.word : '',
          choices: [],
        },
      ]),
    )
  } else {
    s.phase = 'choosing'
    s.boardId = id()
    s.boardArtist = s.actor
    const pool = words(e).length
      ? words(e)
      : Object.values(WORD_PAIRS).flat().flat()
    e.choices = [
      ...new Set(Array.from({ length: 20 }, () => pick(pool))),
    ].slice(0, 3)
    e.word = ''
    e.secrets = Object.fromEntries(
      s.players.map((p) => [
        p.identity,
        { word: '', choices: p.identity === s.actor ? e.choices : [] },
      ]),
    )
  }
}
export const createGartic = (
  controller: string,
  players: PartyMember[],
  settings: GarticSettings,
  now = Date.now(),
): GarticEngine => {
  if (
    players.length < (settings.mode === 'telephone' ? 3 : 2) ||
    players.length > 12
  )
    throw Error(
      settings.mode === 'telephone'
        ? 'O telefone sem fio precisa de 3 a 12 pessoas.'
        : 'O Gartic precisa de 2 a 12 pessoas.',
    )
  const e: GarticEngine = {
    state: {
      ...emptyGarticState(controller),
      gameId: id(),
      players: players.map((p, i) => ({ ...p, score: 0, team: i % 2 })),
      settings,
    },
    word: '',
    choices: [],
    secrets: {},
    story: [],
  }
  prepareTurn(e, now)
  return e
}
export type GarticMove =
  | { type: 'choose'; word: string }
  | { type: 'guess'; text: string }
  | { type: 'finish-drawing' }
  | { type: 'next' }
  | { type: 'tick' }
const finishRound = (e: GarticEngine, now: number) => {
  e.state.phase = 'roundEnd'
  e.state.reveal = e.word
  e.state.stepId = id()
  e.state.deadline = now + 7_000
}
const nextTelephone = (e: GarticEngine, now: number) => {
  const s = e.state
  s.turn++
  if (s.turn >= s.players.length) {
    s.phase = 'finished'
    s.stepId = id()
    s.resultAlbum = structuredClone(e.story)
    s.deadline = 0
  } else prepareTurn(e, now)
}
export const moveGartic = (
  original: GarticEngine,
  sender: string,
  move: GarticMove,
  now = Date.now(),
): GarticEngine => {
  const e = structuredClone(original),
    s = e.state,
    p = s.players.find((p) => p.identity === sender),
    host = sender === s.controllerIdentity
  if (!p && !(host && (move.type === 'tick' || move.type === 'next')))
    throw Error('Você está só assistindo.')
  if (move.type === 'tick') {
    if (!host) throw Error('Ação reservada à mesa.')
    if (now < s.deadline || !s.deadline) return e
    if (s.settings.mode === 'telephone') {
      if (s.phase === 'drawing')
        e.story.push({
          actor: s.actor,
          kind: 'drawing',
          text: '',
          boardId: s.boardId,
        })
      else
        e.story.push({
          actor: s.actor,
          kind: 'text',
          text:
            s.phase === 'prompt' ? 'Uma ideia misteriosa' : '(sem resposta)',
          boardId: '',
        })
      nextTelephone(e, now)
    } else if (s.phase === 'choosing')
      return moveGartic(
        e,
        s.actor,
        { type: 'choose', word: e.choices[0]! },
        now,
      )
    else if (s.phase === 'drawing') finishRound(e, now)
    else if (s.phase === 'roundEnd')
      return moveGartic(e, s.controllerIdentity, { type: 'next' }, now)
    return e
  }
  if (move.type === 'next') {
    if (s.phase !== 'roundEnd' || (!host && sender !== s.actor))
      throw Error('Aguarde o fim da rodada.')
    s.turn++
    if (s.turn >= s.players.length * s.settings.rounds) {
      s.phase = 'finished'
      s.deadline = 0
      s.stepId = id()
    } else prepareTurn(e, now)
    return e
  }
  if (move.type === 'choose') {
    if (
      sender !== s.actor ||
      s.phase !== 'choosing' ||
      !e.choices.includes(move.word)
    )
      throw Error('Escolha uma das palavras disponíveis.')
    e.word = move.word
    s.wordShape = move.word.replace(/[^\s-]/g, '_')
    s.phase = 'drawing'
    s.stepId = id()
    s.deadline = now + s.settings.seconds * 1000
    e.secrets[s.actor] = { word: e.word, choices: [] }
    return e
  }
  if (s.settings.mode === 'telephone') {
    if (sender !== s.actor) throw Error('Aguarde sua vez.')
    if (move.type === 'finish-drawing' && s.phase === 'drawing')
      e.story.push({
        actor: sender,
        kind: 'drawing',
        text: '',
        boardId: s.boardId,
      })
    else if (
      move.type === 'guess' &&
      (s.phase === 'guessing' || s.phase === 'prompt') &&
      move.text.trim()
    )
      e.story.push({
        actor: sender,
        kind: 'text',
        text: move.text.trim().slice(0, 120),
        boardId: '',
      })
    else throw Error('Essa ação não está disponível.')
    nextTelephone(e, now)
    return e
  }
  if (move.type === 'finish-drawing') {
    if (sender !== s.actor || s.phase !== 'drawing')
      throw Error('Você não está desenhando.')
    finishRound(e, now)
    return e
  }
  if (move.type === 'guess') {
    if (
      s.phase !== 'drawing' ||
      sender === s.actor ||
      s.guessed.includes(sender) ||
      !move.text.trim()
    )
      throw Error('Você não pode dar um palpite agora.')
    const correct = cleanWord(move.text) === cleanWord(e.word)
    if (correct) {
      s.guessed.push(sender)
      const points = 100 + Math.round(Math.max(0, s.deadline - now) / 1000)
      p!.score += points
      s.players.find((p) => p.identity === s.actor)!.score += 40
    }
    s.messages = [
      ...s.messages,
      {
        name: p!.name,
        text: correct ? 'Acertou!' : move.text.slice(0, 80),
        correct,
      },
    ].slice(-12)
    if (s.guessed.length === s.players.length - 1) finishRound(e, now)
  }
  return e
}
export const syncGartic = (
  original: GarticEngine,
  members: PartyMember[],
  now = Date.now(),
) => {
  const e = structuredClone(original),
    s = e.state,
    ids = new Set(members.map((p) => p.identity))
  if (s.players.every((p) => ids.has(p.identity))) return e
  s.players = s.players.filter((p) => ids.has(p.identity))
  s.guessed = s.guessed.filter((p) => ids.has(p))
  if (s.players.length < 2 || s.settings.mode === 'telephone') {
    s.phase = 'finished'
    s.deadline = 0
    s.resultAlbum = e.story
    s.stepId = id()
  } else if (!ids.has(s.actor)) finishRound(e, now)
  else if (s.phase === 'drawing' && s.guessed.length === s.players.length - 1)
    finishRound(e, now)
  return e
}

export const parseImpostorState = (v: unknown): ImpostorState | null => {
  if (!v || typeof v !== 'object') return null
  const s = v as ImpostorState
  return validPartyBase(s) &&
    ['lobby', 'talk', 'vote', 'result'].includes(s.phase) &&
    ['related', 'impostor'].includes(s.mode) &&
    Array.isArray(s.requests) &&
    s.requests.length <= 12 &&
    s.requests.every((x) => safeText(x, 128)) &&
    Array.isArray(s.voted) &&
    s.voted.length <= 12 &&
    s.voted.every((x) => safeText(x, 128)) &&
    (s.phase === 'result'
      ? Boolean(
          s.result &&
            safeText(s.result.word) &&
            safeText(s.result.otherWord) &&
            safeText(s.result.impostor, 128) &&
            Array.isArray(s.result.accused),
        )
      : s.result === null)
    ? structuredClone(s)
    : null
}
export const parseGarticState = (v: unknown): GarticState | null => {
  if (!v || typeof v !== 'object') return null
  const s = v as GarticState
  return validPartyBase(s) &&
    [
      'lobby',
      'prompt',
      'choosing',
      'drawing',
      'guessing',
      'roundEnd',
      'finished',
    ].includes(s.phase) &&
    readGarticSettings(s.settings) &&
    safeText(s.actor, 128) &&
    safeText(s.boardId, 128) &&
    Number.isFinite(s.deadline) &&
    Number.isInteger(s.turn) &&
    s.turn >= 0 &&
    s.turn < 100 &&
    Array.isArray(s.guessed) &&
    s.guessed.length <= 12 &&
    Array.isArray(s.messages) &&
    s.messages.length <= 12 &&
    s.messages.every(
      (m) =>
        safeText(m.name, 80) &&
        safeText(m.text, 120) &&
        typeof m.correct === 'boolean',
    ) &&
    Array.isArray(s.resultAlbum) &&
    s.resultAlbum.length <= 12 &&
    safeText(s.reveal, 120) &&
    safeText(s.wordShape, 120)
    ? structuredClone(s)
    : null
}
const validPartyBase = (s: ImpostorState | GarticState) =>
  safeText(s.gameId, 128) &&
  safeText(s.controllerIdentity, 128) &&
  safeText(s.stepId, 128) &&
  Number.isSafeInteger(s.revision) &&
  s.revision >= 0 &&
  Array.isArray(s.players) &&
  s.players.length <= 12 &&
  s.players.every((p) => safeText(p.identity, 128) && safeText(p.name, 80)) &&
  new Set(s.players.map((p) => p.identity)).size === s.players.length
