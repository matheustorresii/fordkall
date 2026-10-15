import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyCodenamesMove,
  codenamesCurrentClue,
  codenamesGuessesLeft,
  codenamesPauseReason,
  codenamesPrivateFor,
  codenamesStartError,
  codenamesWord,
  createCodenamesMatch,
  emptyCodenamesState,
  normalizeCodenamesWord,
  otherCodenamesTeam,
  readCodenamesSettings,
  syncCodenamesMembers,
} from '../src/games/codenames.ts'
import { parseCodenamesMove, parseCodenamesPrivate, parseCodenamesState } from '../src/games/codenamesWire.ts'
import { CODENAMES_WORDS } from '../src/games/codenamesWords.ts'

const people = (count = 4) =>
  Array.from({ length: count }, (_, i) => ({ identity: `p${i}`, name: `Pessoa ${i}` }))
const seeded = (seed) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 0x100000000
}
const lobby = (count = 4) => {
  let engine = syncCodenamesMembers({ state: emptyCodenamesState('p0'), key: [] }, people(count))
  for (let i = 0; i < count; i++)
    engine = applyCodenamesMove(engine, `p${i}`, {
      type: 'seat',
      team: i % 2 ? 'blue' : 'red',
      role: i < 2 ? 'spymaster' : 'operative',
    })
  return engine
}
const match = (seed = 1, count = 4) => createCodenamesMatch(lobby(count).state, undefined, seeded(seed))
const spy = (e, team = e.state.turnTeam) =>
  e.state.players.find((p) => p.team === team && p.role === 'spymaster').identity
const agent = (e, team = e.state.turnTeam) =>
  e.state.players.find((p) => p.team === team && p.role === 'operative').identity
const clue = (e, count = 1, word = 'EXEMPLO') => applyCodenamesMove(e, spy(e), { type: 'clue', word, count })
const card = (e, kind, skip = []) =>
  e.state.board.find((c, i) => e.key[i] === kind && !c.revealed && !skip.includes(c.id))
const guess = (e, kind = e.state.turnTeam) =>
  applyCodenamesMove(e, agent(e), { type: 'guess', cardId: card(e, kind).id })
const roundTrip = (e) => assert.deepEqual(parseCodenamesState(JSON.parse(JSON.stringify(e.state))), e.state)

test('banco PT-BR original: palavras válidas, variedade e sem duplicatas normalizadas', () => {
  assert.ok(CODENAMES_WORDS.length >= 400)
  assert.ok(CODENAMES_WORDS.every(codenamesWord))
  assert.equal(new Set(CODENAMES_WORDS.map(normalizeCodenamesWord)).size, CODENAMES_WORDS.length)
})
test('lobby: cada pessoa escolhe apenas seu papel, com um mestre por equipe e capacidade 12', () => {
  let e = lobby()
  assert.equal(codenamesStartError(e.state), '')
  assert.throws(() => applyCodenamesMove(e, 'p2', { type: 'seat', team: 'red', role: 'spymaster' }))
  assert.throws(() => applyCodenamesMove(e, 'fora', { type: 'seat', team: 'red', role: 'operative' }))
  e = applyCodenamesMove(e, 'p0', { type: 'seat', team: null, role: 'operative' })
  assert.notEqual(codenamesStartError(e.state), '')
  assert.throws(() => createCodenamesMatch(e.state))
  assert.equal(parseCodenamesState(emptyCodenamesState('p0')).phase, 'lobby')
  roundTrip(lobby(12))
})
test('sortear monta duas equipes com mestre e agentes, de 4 a 12 pessoas', () => {
  for (let count = 4; count <= 12; count++) {
    const before = syncCodenamesMembers({ state: emptyCodenamesState('p0'), key: [] }, people(count))
    const next = applyCodenamesMove(before, 'p0', { type: 'shuffle' })
    assert.equal(codenamesStartError(next.state), '')
    assert.ok(before.state.players.every((p) => p.team === null))
    assert.ok(
      Math.abs(
        next.state.players.filter((p) => p.team === 'red').length -
          next.state.players.filter((p) => p.team === 'blue').length,
      ) <= 1,
    )
    roundTrip(next)
  }
  assert.throws(() => applyCodenamesMove(lobby(3), 'p0', { type: 'shuffle' }))
})
test('tabuleiro de 25: nove agentes de quem começa, oito rivais, sete civis e um assassino', () => {
  for (let seed = 0; seed < 100; seed++) {
    const e = match(seed),
      first = e.state.startingTeam
    assert.equal(e.key.length, 25)
    assert.equal(e.key.filter((k) => k === first).length, 9)
    assert.equal(e.key.filter((k) => k === otherCodenamesTeam(first)).length, 8)
    assert.equal(e.key.filter((k) => k === 'neutral').length, 7)
    assert.equal(e.key.filter((k) => k === 'assassin').length, 1)
    assert.equal(new Set(e.state.board.map((c) => normalizeCodenamesWord(c.word))).size, 25)
    assert.ok(e.state.board.every((c) => c.revealed === null))
    assert.deepEqual(e.state.solution, [])
    roundTrip(e)
  }
})
test('chave é privada dos dois mestres; estado público não contém donos das cartas ocultas', () => {
  const e = match(),
    publicState = parseCodenamesState({ ...e.state, key: e.key, secret: 'não serializar' })
  assert.equal('key' in publicState, false)
  assert.equal('secret' in publicState, false)
  for (const p of e.state.players) {
    const secret = codenamesPrivateFor(e, p.identity)
    assert.equal(secret.key.length, p.role === 'spymaster' ? 25 : 0)
    if (secret.key.length) secret.key.pop()
    assert.equal(e.key.length, 25, 'cópia não altera chave autoritativa')
  }
  assert.deepEqual(codenamesPrivateFor(e, 'visitante'), { key: [] })
  assert.equal(parseCodenamesPrivate({ key: e.key }).key.length, 25)
  assert.equal(parseCodenamesPrivate({ key: e.key.slice(1) }), null)
  assert.equal(parseCodenamesPrivate({ key: Array(25).fill('red') }), null)
})
test('pista: uma palavra + número; somente o mestre da vez pode enviá-la', () => {
  const e = match(),
    turn = e.state.turnTeam
  for (const id of [agent(e), spy(e, otherCodenamesTeam(turn)), 'visitante'])
    assert.throws(() => applyCodenamesMove(e, id, { type: 'clue', word: 'EXEMPLO', count: 2 }))
  for (const word of ['', 'duas palavras', 'a\nb', '<script>', 'a'.repeat(25), e.state.board[0].word])
    assert.throws(() => clue(e, 2, word))
  for (const count of [-1, 10, 2.5, NaN, Infinity, '1']) assert.throws(() => clue(e, count))
  const next = clue(e, 2)
  assert.equal(next.state.phase, 'guess')
  assert.equal(codenamesGuessesLeft(next.state), 3)
  assert.equal(codenamesCurrentClue(next.state).word, 'EXEMPLO')
  assert.equal(e.state.clues.length, 0)
  assert.notEqual(next.state.stepId, e.state.stepId)
  roundTrip(next)
})
test('acentos e caixa não burlam a regra da palavra visível; palavras reveladas podem ser pistas', () => {
  let e = match()
  e.state.board[0].word = 'ÂNCORA'
  assert.throws(() => clue(e, 1, 'ancora'))
  e.state.board[0].revealed = 'neutral'
  assert.equal(clue(e, 1, 'âncora').state.phase, 'guess')
  e.state.board[0] = { ...e.state.board[0], word: 'PÉ-DE-MOLEQUE', revealed: null }
  assert.throws(() => clue(e, 1, 'moleque'))
})
test('palpites compartilhados não revelam cartas nem consomem tentativas; são idempotentes', () => {
  let e = clue(match()),
    id = agent(e),
    chosen = card(e, e.state.turnTeam).id
  e = applyCodenamesMove(e, id, { type: 'suggest', cardId: chosen })
  e = applyCodenamesMove(e, id, { type: 'suggest', cardId: chosen })
  assert.equal(e.state.suggestions[id], chosen)
  assert.equal(codenamesGuessesLeft(e.state), 2)
  assert.equal(e.state.board.filter((c) => c.revealed).length, 0)
  assert.throws(() => applyCodenamesMove(e, spy(e), { type: 'suggest', cardId: chosen }))
  e = applyCodenamesMove(e, id, { type: 'suggest', cardId: null })
  assert.deepEqual(e.state.suggestions, {})
  roundTrip(e)
})
test('agente correto permite continuar e dá uma tentativa extra; limite encerra o turno', () => {
  let e = clue(match(), 1),
    original = e.state.turnTeam
  const before = JSON.stringify(e)
  e = guess(e)
  assert.equal(e.state.phase, 'guess')
  assert.equal(e.state.remaining[original], 8)
  assert.equal(codenamesGuessesLeft(e.state), 1)
  assert.notEqual(JSON.stringify(e), before)
  e = guess(e)
  assert.equal(e.state.phase, 'clue')
  assert.equal(e.state.turnTeam, otherCodenamesTeam(original))
  assert.equal(e.state.turn, 2)
  roundTrip(e)
})
test('mestre, adversário e espectador não revelam; carta já aberta não pode ser escolhida novamente', () => {
  let e = clue(match(), 5),
    id = card(e, e.state.turnTeam).id
  for (const actor of [spy(e), agent(e, otherCodenamesTeam(e.state.turnTeam)), 'fora'])
    assert.throws(() => applyCodenamesMove(e, actor, { type: 'guess', cardId: id }))
  e = applyCodenamesMove(e, agent(e), { type: 'guess', cardId: id })
  assert.throws(() => applyCodenamesMove(e, agent(e), { type: 'guess', cardId: id }))
  assert.throws(() => applyCodenamesMove(e, agent(e), { type: 'guess', cardId: 'fora' }))
})
test('civil encerra o turno sem alterar agentes; carta rival dá ponto ao rival e encerra o turno', () => {
  for (const target of ['neutral', 'opponent']) {
    let e = clue(match()),
      original = e.state.turnTeam,
      other = otherCodenamesTeam(original)
    const remaining = { ...e.state.remaining }
    e = guess(e, target === 'neutral' ? 'neutral' : other)
    assert.equal(e.state.phase, 'clue')
    assert.equal(e.state.turnTeam, other)
    assert.equal(e.state.remaining[original], remaining[original])
    assert.equal(e.state.remaining[other], remaining[other] - (target === 'opponent' ? 1 : 0))
    roundTrip(e)
  }
})
test('passar só é permitido depois de pelo menos uma tentativa; zero e infinito não retiram essa regra', () => {
  for (const count of [0, 1, 'unlimited']) {
    let e = clue(match(), count)
    assert.throws(() => applyCodenamesMove(e, agent(e), { type: 'pass' }))
    e = guess(e)
    e = applyCodenamesMove(e, agent(e), { type: 'pass' })
    assert.equal(e.state.phase, 'clue')
    assert.equal(e.state.turn, 2)
    roundTrip(e)
  }
})
test('pistas 0 e infinito permitem continuar além de número + 1', () => {
  for (const count of [0, 'unlimited']) {
    let e = clue(match(), count)
    for (let i = 0; i < 5; i++) {
      e = guess(e)
      assert.equal(e.state.phase, 'guess')
    }
    assert.equal(codenamesGuessesLeft(e.state), null)
    roundTrip(e)
  }
})
test('assassino encerra imediatamente, dá vitória rival e revela a chave apenas no resultado', () => {
  const before = clue(match()),
    other = otherCodenamesTeam(before.state.turnTeam),
    next = guess(before, 'assassin')
  assert.equal(next.state.phase, 'finished')
  assert.equal(next.state.winner, other)
  assert.equal(next.state.finishReason, 'assassin')
  assert.deepEqual(next.state.solution, next.key)
  assert.deepEqual(before.state.solution, [])
  assert.throws(() => guess(next))
  roundTrip(next)
})
test('encontrar todos os agentes encerra sem turno extra; nova partida usa outra chave e outro id', () => {
  let e = clue(match(), 'unlimited'),
    winner = e.state.turnTeam
  for (let i = 0; i < 9; i++) e = guess(e)
  assert.equal(e.state.phase, 'finished')
  assert.equal(e.state.winner, winner)
  assert.equal(e.state.remaining[winner], 0)
  assert.equal(e.state.finishReason, 'agents')
  roundTrip(e)
  const next = createCodenamesMatch(e.state, undefined, seeded(42))
  assert.notEqual(next.state.gameId, e.state.gameId)
  assert.deepEqual(next.state.solution, [])
  assert.ok(next.state.board.every((c) => c.revealed === null))
  assert.notDeepEqual(next.key, e.key)
})
test('revelar o último agente rival dá vitória a ele, e não simplesmente troca o turno', () => {
  let e = match(),
    target = otherCodenamesTeam(e.state.turnTeam)
  // Each round both teams deliberately uncover that team's agents; the final hit is by its opponent.
  while (e.state.remaining[target] > 1) {
    if (e.state.phase === 'clue') e = clue(e, 1)
    e = guess(e, target)
  }
  if (e.state.turnTeam === target) {
    if (e.state.phase === 'clue') e = clue(e)
    e = guess(e, 'neutral')
  }
  if (e.state.phase === 'clue') e = clue(e)
  e = guess(e, target)
  assert.equal(e.state.phase, 'finished')
  assert.equal(e.state.winner, target)
  roundTrip(e)
})
test('papéis e equipes ficam travados depois que a chave foi distribuída', () => {
  const e = match()
  assert.throws(() => applyCodenamesMove(e, spy(e), { type: 'seat', team: 'blue', role: 'operative' }))
  assert.throws(() => applyCodenamesMove(e, agent(e), { type: 'shuffle' }))
  assert.throws(() => createCodenamesMatch(e.state))
})
test('entrada tardia é espectador; reconexão preserva papel e chave; ausência de papel essencial pausa', () => {
  let e = match(),
    original = JSON.stringify(e.key),
    id = spy(e),
    initial = e.state.players.find((p) => p.identity === id)
  e = syncCodenamesMembers(
    e,
    people().filter((p) => p.identity !== id),
  )
  assert.ok(codenamesPauseReason(e.state))
  assert.throws(() => clue(e))
  e = syncCodenamesMembers(e, people(5))
  assert.equal(codenamesPauseReason(e.state), '')
  assert.equal(e.state.players.find((p) => p.identity === id).role, initial.role)
  assert.equal(
    e.state.players.find((p) => p.identity === 'p4'),
    undefined,
  )
  assert.deepEqual(codenamesPrivateFor(e, 'p4'), { key: [] })
  assert.equal(JSON.stringify(e.key), original)
  roundTrip(e)
})
test('palavras personalizadas: 25–300 únicas, acentos normalizados e entradas ruins rejeitadas', () => {
  const words = Array.from({ length: 25 }, (_, i) => `PALAVRA${i}`)
  assert.equal(readCodenamesSettings({ customWords: words }).customWords.length, 25)
  assert.deepEqual(readCodenamesSettings(undefined), { customWords: [] })
  for (const value of [
    null,
    {},
    { customWords: ['CASA'] },
    { customWords: Array(25).fill('CASA') },
    { customWords: [...words, 'duas palavras'] },
    { customWords: [...words, 'a'.repeat(25)] },
    { customWords: [...words, '<img>'] },
    { customWords: Array(301).fill('PALAVRA') },
  ])
    assert.equal(readCodenamesSettings(value), null)
  const e = createCodenamesMatch(lobby().state, { customWords: words }, seeded(5))
  assert.ok(e.state.board.every((c) => words.includes(c.word)))
  roundTrip(e)
})
test('wire rejeita estados incoerentes, chave precoce, entidades desconhecidas e ações inválidas', () => {
  const e = match(),
    clone = () => JSON.parse(JSON.stringify(e.state))
  for (const mutate of [
    (s) => {
      s.solution = e.key
    },
    (s) => {
      s.board.pop()
    },
    (s) => {
      s.board[0].word = s.board[1].word
    },
    (s) => {
      s.board[0].revealed = 'red'
    },
    (s) => {
      s.players.push(s.players[0])
    },
    (s) => {
      s.remaining.red = 99
    },
    (s) => {
      s.events = [{ id: 1, text: 'x'.repeat(241) }]
    },
    (s) => {
      s.phase = 'hack'
    },
  ]) {
    const s = clone()
    mutate(s)
    assert.equal(parseCodenamesState(s), null)
  }
  for (const move of [
    null,
    {},
    { type: 'guess', cardId: '' },
    { type: 'seat', team: 'green', role: 'spymaster' },
    { type: 'clue', word: 'Pista', count: 10 },
    { type: 'reveal-key' },
  ])
    assert.equal(parseCodenamesMove(move), null)
  assert.deepEqual(parseCodenamesMove({ type: 'suggest', cardId: null, key: e.key }), {
    type: 'suggest',
    cardId: null,
  })
})
test('300 partidas de 4–12: turnos, privacidade, cartas únicas e conclusão sem travar', () => {
  for (let seed = 0; seed < 300; seed++) {
    let e = match(seed, 4 + (seed % 9)),
      steps = 0
    const random = seeded(seed + 801)
    while (e.state.phase !== 'finished') {
      assert.ok(steps++ < 100)
      assert.deepEqual(e.state.solution, [])
      roundTrip(e)
      if (e.state.phase === 'clue') e = clue(e, [0, 1, 2, 3, 'unlimited'][Math.floor(random() * 5)])
      else {
        const available = e.state.board.filter((c) => !c.revealed)
        const chosen = available[Math.floor(random() * available.length)]
        e = applyCodenamesMove(e, agent(e), { type: 'guess', cardId: chosen.id })
      }
    }
    assert.ok(e.state.winner)
    roundTrip(e)
    assert.equal(new Set(e.state.board.map((c) => c.id)).size, 25)
  }
})
test('partida longa com 12 perfis extensos e espectadores continua abaixo de 15 KiB por pacote', () => {
  const members = Array.from({ length: 32 }, (_, i) => ({
    identity: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    name: `${'界'.repeat(78)}${String(i).padStart(2, '0')}`,
  }))
  let e = syncCodenamesMembers({ state: emptyCodenamesState(members[0].identity), key: [] }, members)
  const check = () => {
    assert.ok(Buffer.byteLength(JSON.stringify({ type: 'state', state: e.state })) < 15 * 1024)
    roundTrip(e)
  }
  check()
  for (let i = 0; i < 12; i++)
    e = applyCodenamesMove(e, members[i].identity, {
      type: 'seat',
      team: i % 2 ? 'blue' : 'red',
      role: i < 2 ? 'spymaster' : 'operative',
    })
  e = createCodenamesMatch(
    e.state,
    { customWords: Array.from({ length: 25 }, (_, i) => `${'界'.repeat(20)}${i}`) },
    seeded(42),
  )
  assert.equal(e.state.players.length, 12, 'espectadores não incham o estado de uma partida ativa')
  let steps = 0
  while (e.state.phase !== 'finished') {
    assert.ok(steps++ < 100)
    check()
    if (e.state.phase === 'clue') e = clue(e, 1, '詩'.repeat(24))
    else {
      const target =
        card(e, 'neutral') ??
        ['red', 'blue']
          .flatMap((team) => (e.state.remaining[team] > 1 ? [card(e, team)] : []))
          .find(Boolean) ??
        card(e, e.state.turnTeam)
      e = applyCodenamesMove(e, agent(e), { type: 'guess', cardId: target.id })
      if (e.state.phase === 'guess') e = applyCodenamesMove(e, agent(e), { type: 'pass' })
    }
  }
  check()
  assert.ok(e.state.clues.length >= 20)
  assert.equal(e.state.events.length, 1)
  const tooLarge = Array.from({ length: 300 }, (_, i) => `${'界'.repeat(19)}${i}`)
  assert.equal(readCodenamesSettings({ customWords: tooLarge }), null)
})
