import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ODIN_CLANS,
  advanceOdinHand,
  applyOdinMove,
  createOdinMatch,
  defaultOdinSettings,
  emptyOdinState,
  expireOdinTurn,
  odinDeck,
  odinLegalPlays,
  odinPlayError,
  odinSameGroup,
  odinValue,
  readOdinSettings,
  syncOdinMembers,
} from '../src/games/odin.ts'
import {
  parseOdinCards,
  parseOdinMove,
  parseOdinPrivate,
  parseOdinState,
} from '../src/games/odinWire.ts'
const c = (clan, value) => ({ id: `${clan}-${value}`, clan, value })
const a = (...values) => values.map((v) => c('leaf', v))
const b = (...values) => values.map((v) => c('tide', v))
const members = (count) =>
  Array.from({ length: count }, (_, i) => ({
    identity: `p${i}`,
    name: `Jogador ${i + 1}`,
  }))
function fixture(hands, center = [], options = {}) {
  const engine = createOdinMatch(
    members(hands.length),
    {
      ...defaultOdinSettings,
      singleHand: true,
      duelFourClans: false,
      ...options,
    },
    { random: () => 0, now: 1000 },
  )
  const used = [...hands.flat(), ...center].map((c) => c.id)
  assert.equal(used.length, new Set(used).size)
  engine.hands = Object.fromEntries(hands.map((cards, i) => [`p${i}`, cards]))
  engine.state.players.forEach((p, i) => (p.cardsRemaining = hands[i].length))
  engine.state.center = center
  engine.state.lastPlayer = center.length ? `p${hands.length - 1}` : ''
  engine.state.current = 'p0'
  engine.state.asideCount = 54 - used.length
  engine.aside = odinDeck().filter((c) => !used.includes(c.id))
  return engine
}
function invariant(engine) {
  const s = engine.state
  const all = [
    ...Object.values(engine.hands).flat(),
    ...s.center,
    ...engine.discarded,
    ...engine.aside,
  ]
  assert.equal(all.length, s.deckSize)
  assert.equal(
    new Set(all.map((c) => c.id)).size,
    s.deckSize,
    'A carta não pode estar em dois lugares',
  )
  assert.ok(
    all.every(
      (c) => c.id === `${c.clan}-${c.value}` && c.value >= 1 && c.value <= 9,
    ),
  )
  assert.ok(
    s.players.every(
      (p) =>
        p.cardsRemaining === engine.hands[p.identity].length &&
        (!p.away || !p.cardsRemaining),
    ),
  )
  assert.deepEqual(parseOdinState(s), s)
  assert.ok(
    Buffer.byteLength(JSON.stringify({ type: 'state', state: s })) < 15000,
  )
}
test('54 cartas únicas, seis clãs e valores 1–9; a variante de duelo retira só dois clãs', () => {
  assert.equal(odinDeck().length, 54)
  assert.equal(new Set(odinDeck().map((c) => c.id)).size, 54)
  assert.equal(odinDeck(true).length, 36)
  for (const clan of ODIN_CLANS)
    assert.deepEqual(
      odinDeck()
        .filter((c) => c.clan === clan)
        .map((c) => c.value),
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
    )
})
test('nove cartas privadas para cada uma das 2–6 pessoas, sem compra posterior do monte', () => {
  for (let count = 2; count <= 6; count++) {
    const e = createOdinMatch(members(count))
    assert.ok(Object.values(e.hands).every((hand) => hand.length === 9))
    assert.equal(e.aside.length, e.state.deckSize - count * 9)
    invariant(e)
  }
})
test('configurações inválidas, jogadores repetidos e identidades perigosas são recusados', () => {
  for (const patch of [
    { pointLimit: 0 },
    { pointLimit: 12 },
    { turnSeconds: 1 },
    { singleHand: 'yes' },
    { duelFourClans: null },
  ])
    assert.equal(readOdinSettings({ ...defaultOdinSettings, ...patch }), null)
  for (const count of [0, 1, 7])
    assert.throws(() => createOdinMatch(members(count)))
  assert.throws(() => createOdinMatch([members(2)[0], members(2)[0]]))
  assert.throws(() =>
    createOdinMatch([{ identity: '__proto__', name: 'Bad' }, members(2)[1]]),
  )
  assert.throws(() =>
    createOdinMatch(members(2), defaultOdinSettings, { random: () => NaN }),
  )
})
test('combinações concatenam em ordem decrescente: 2+8 vira 82, não soma nem 28', () => {
  assert.equal(odinValue(a(2, 8)), 82)
  assert.equal(odinValue(a(2, 4, 9)), 942)
  assert.equal(odinValue([c('leaf', 3), c('tide', 3)]), 33)
  assert.ok(odinSameGroup(a(1, 8)))
  assert.equal(odinSameGroup([c('leaf', 1), c('tide', 2)]), false)
})
test('a abertura aceita uma carta ou TODA a mão compatível; nunca uma combinação parcial', () => {
  const e = fixture([a(1, 2, 3), b(4, 5, 6)])
  assert.match(odinPlayError(e.hands.p0, [], ['leaf-1', 'leaf-2']), /todas/)
  assert.equal(odinPlayError(e.hands.p0, [], ['leaf-1']), null)
  const done = applyOdinMove(e, 'p0', {
    type: 'play',
    cardIds: e.hands.p0.map((c) => c.id),
  })
  assert.equal(done.state.phase, 'finished')
  assert.equal(done.hands.p0.length, 0)
  invariant(done)
})
test('a combinação responde com a mesma quantidade ou mais uma, sem exigir cor/valor igual à mesa', () => {
  assert.equal(odinPlayError(a(1, 3, 5), b(2, 4), ['leaf-3', 'leaf-5']), null)
  assert.equal(
    odinPlayError(a(1, 3, 5), b(2, 4), ['leaf-1', 'leaf-3', 'leaf-5']),
    null,
  )
  assert.match(
    odinPlayError(
      a(1, 3, 5, 7),
      b(2, 4),
      a(1, 3, 5, 7).map((c) => c.id),
    ),
    /2 ou 3/,
  )
  assert.match(odinPlayError(a(5), b(2, 4), ['leaf-5']), /2 ou 3/)
})
test('mesmo para esvaziar, quatro cartas não cobrem duas: regressão do FAQ oficial', () => {
  const e = fixture([a(2, 4, 6, 8), [c('sun', 1)]], b(1, 3))
  assert.throws(
    () =>
      applyOdinMove(e, 'p0', {
        type: 'play',
        cardIds: a(2, 4, 6, 8).map((c) => c.id),
      }),
    /2 ou 3/,
  )
})
test('valor igual ou menor é inválido; duplicatas e cartas alheias não se jogam', () => {
  assert.ok(odinPlayError(a(3), b(3), ['leaf-3']))
  assert.ok(odinPlayError(a(3), b(4), ['leaf-3']))
  assert.ok(odinPlayError(a(3, 4), [], ['leaf-3', 'leaf-3']))
  assert.ok(odinPlayError(a(3, 4), [], ['moon-9']))
})
test('ao cobrir uma carta, ela entra na mão; o jogador nunca pega uma que acabou de jogar', () => {
  const e = fixture([a(4, 7), b(2, 9)], [c('sun', 3)])
  const n = applyOdinMove(e, 'p0', { type: 'play', cardIds: ['leaf-4'] })
  assert.deepEqual(
    n.hands.p0.map((c) => c.id),
    ['leaf-7', 'sun-3'],
  )
  assert.equal(n.state.center[0].id, 'leaf-4')
  assert.equal(n.state.current, 'p1')
  invariant(n)
})
test('uma mesa com várias cartas exige escolher uma da jogada anterior; as outras são descartadas', () => {
  const e = fixture([a(4, 7, 8), [c('sun', 9)]], b(1, 2))
  assert.throws(
    () =>
      applyOdinMove(e, 'p0', { type: 'play', cardIds: ['leaf-7', 'leaf-8'] }),
    /Escolha/,
  )
  assert.throws(
    () =>
      applyOdinMove(e, 'p0', {
        type: 'play',
        cardIds: ['leaf-7', 'leaf-8'],
        takeId: 'leaf-8',
      }),
    /Escolha/,
  )
  const n = applyOdinMove(e, 'p0', {
    type: 'play',
    cardIds: ['leaf-7', 'leaf-8'],
    takeId: 'tide-2',
  })
  assert.deepEqual(
    n.hands.p0.map((c) => c.id),
    ['leaf-4', 'tide-2'],
  )
  assert.deepEqual(
    n.discarded.map((c) => c.id),
    ['tide-1'],
  )
  assert.equal(n.state.lastPlay.taken.id, 'tide-2')
  invariant(n)
})
test('a última combinação vence sem pegar carta, tanto na abertura como cobrindo a mesa', () => {
  const e = fixture([a(6, 8), [c('sun', 9)]], b(1, 2))
  const n = applyOdinMove(e, 'p0', {
    type: 'play',
    cardIds: ['leaf-6', 'leaf-8'],
  })
  assert.equal(n.hands.p0.length, 0)
  assert.equal(n.state.result.winner, 'p0')
  assert.equal(n.state.lastPlay.taken, null)
  assert.deepEqual(n.discarded, b(1, 2))
  invariant(n)
})
test('passar é temporário; depois de outra jogada o mesmo jogador pode voltar normalmente', () => {
  let e = fixture(
    [a(8, 9), b(5, 6), [c('sun', 7), c('sun', 9)]],
    [c('ember', 1)],
  )
  e.state.lastPlayer = 'p2'
  e = applyOdinMove(e, 'p0', { type: 'pass' })
  e = applyOdinMove(e, 'p1', { type: 'play', cardIds: ['tide-5'] })
  e = applyOdinMove(e, 'p2', { type: 'pass' })
  assert.equal(e.state.current, 'p0')
  assert.equal(odinPlayError(e.hands.p0, e.state.center, ['leaf-8']), null)
  assert.equal(
    applyOdinMove(e, 'p0', { type: 'play', cardIds: ['leaf-8'] }).state
      .lastPlayer,
    'p0',
  )
})
test('N−1 passes consecutivos limpam a mesa e o último a jogar abre; não joga sobre si mesmo', () => {
  let e = fixture(
    [a(2, 8), b(4, 6), [c('sun', 3), c('sun', 5)]],
    [c('ember', 9)],
  )
  e.state.current = 'p1'
  e.state.lastPlayer = 'p0'
  e = applyOdinMove(e, 'p1', { type: 'pass' })
  e = applyOdinMove(e, 'p2', { type: 'pass' })
  assert.equal(e.state.current, 'p0')
  assert.deepEqual(e.state.center, [])
  assert.equal(e.state.roundNumber, 2)
  assert.throws(() => applyOdinMove(e, 'p0', { type: 'pass' }), /precisa jogar/)
  invariant(e)
})
test('pontos são a quantidade de cartas restantes, não a soma dos números', () => {
  const e = fixture([a(9), b(7, 8, 9)])
  const n = applyOdinMove(e, 'p0', { type: 'play', cardIds: ['leaf-9'] })
  assert.deepEqual(
    n.state.result.entries.map((p) => p.penalty),
    [0, 3],
  )
  assert.equal(n.state.players[1].score, 3)
})
test('o menor total ganha a partida; esvaziar a última mão não apaga os pontos anteriores', () => {
  const e = fixture([a(9), b(1, 2, 3)], [], {
    singleHand: false,
    pointLimit: 15,
  })
  e.state.players[0].score = 15
  e.state.players[1].score = 5
  const n = applyOdinMove(e, 'p0', { type: 'play', cardIds: ['leaf-9'] })
  assert.equal(n.state.phase, 'finished')
  assert.deepEqual(n.state.winners, ['p1'])
  invariant(n)
})
test('empates no menor total compartilham a vitória', () => {
  const e = fixture([a(9), b(1), [c('sun', 3), c('sun', 4)]], [], {
    singleHand: false,
    pointLimit: 10,
  })
  e.state.players[0].score = 1
  e.state.players[2].score = 8
  const n = applyOdinMove(e, 'p0', { type: 'play', cardIds: ['leaf-9'] })
  assert.deepEqual(n.state.winners, ['p0', 'p1'])
})
test('a próxima mão conserva os pontos e roda quem abre para a esquerda de quem começou a anterior', () => {
  let e = fixture([a(9), b(7, 8)], [], { singleHand: false })
  e = applyOdinMove(
    e,
    'p0',
    { type: 'play', cardIds: ['leaf-9'] },
    { now: 1000 },
  )
  assert.equal(e.state.phase, 'hand-result')
  assert.equal(e.state.transitionAt, 9000)
  e = advanceOdinHand(e, { now: 10000 })
  assert.equal(e.state.starter, 'p1')
  assert.equal(e.state.current, 'p1')
  assert.equal(e.state.handNumber, 2)
  assert.deepEqual(
    e.state.players.map((p) => p.score),
    [0, 2],
  )
  assert.ok(e.state.players.every((p) => p.cardsRemaining === 9))
  invariant(e)
})
test('não há timeout por padrão; o opcional passa, abre com uma carta ou termina a mão compatível', () => {
  const e = fixture([a(1, 2), b(4)], [], { turnSeconds: 30 })
  assert.equal(expireOdinTurn(e, { now: 30999 }), e)
  const n = expireOdinTurn(e, { now: 31000 })
  assert.equal(n.state.phase, 'finished')
  const ordinary = fixture([[c('leaf', 1), c('tide', 5)], a(7)], [], {
    turnSeconds: 30,
  })
  const opened = expireOdinTurn(ordinary, { now: 31000 })
  assert.equal(opened.state.center[0].id, 'leaf-1')
  assert.equal(
    expireOdinTurn(fixture([a(1), b(3)]), { now: 1e9 }).state.phase,
    'playing',
  )
})
test('optout retira só aquela mão, mantém a pontuação e cancela a disputa sem bloquear os outros', () => {
  const e = fixture(
    [a(2, 8), b(4, 6), [c('sun', 3), c('sun', 5)]],
    [c('ember', 9)],
  )
  e.state.players[0].score = 2
  const n = syncOdinMembers(e, new Set(['p1', 'p2']))
  assert.ok(n.state.players[0].away)
  assert.deepEqual(n.hands.p0, [])
  assert.equal(n.state.players[0].score, 2)
  assert.equal(n.state.current, 'p1')
  assert.deepEqual(n.state.center, [])
  assert.equal(n.state.phase, 'playing')
  invariant(n)
  assert.equal(
    syncOdinMembers(n, new Set(['p0', 'p1', 'p2'])),
    n,
    'Voltar a participar não recebe cartas no meio desta partida',
  )
})
test('faltar gente encerra sem inventar vencedor nem pontos', () => {
  const e = fixture([a(1, 2), b(3, 4)])
  const n = syncOdinMembers(e, new Set(['p0']))
  assert.equal(n.state.phase, 'finished')
  assert.equal(n.state.finishReason, 'not-enough-players')
  assert.deepEqual(n.state.winners, [])
  invariant(n)
})
test('jogadas são imutáveis e fora de vez não alteram nenhuma carta', () => {
  const e = fixture([a(2, 8), b(4, 6)])
  const before = structuredClone(e)
  assert.throws(
    () => applyOdinMove(e, 'p1', { type: 'play', cardIds: ['tide-4'] }),
    /vez/,
  )
  const n = applyOdinMove(e, 'p0', { type: 'play', cardIds: ['leaf-2'] })
  assert.deepEqual(e, before)
  assert.notEqual(e, n)
})
test('wire permite só cartas canônicas e não transporta mãos/baralho por estado público', () => {
  const e = fixture([a(1, 2), b(3, 4)])
  const parsed = parseOdinState({
    ...e.state,
    hands: e.hands,
    deck: ['SECRET'],
    authority: { secret: 'SECRET' },
  })
  assert.deepEqual(parsed, e.state)
  assert.ok(!JSON.stringify(parsed).includes('SECRET'))
  assert.equal(parseOdinCards([{ ...c('leaf', 1), value: 9 }]), null)
  assert.equal(parseOdinPrivate({ hand: [...a(1), ...a(1)] }), null)
  assert.equal(
    parseOdinMove({ type: 'play', cardIds: ['leaf-1', 'leaf-1'] }),
    null,
  )
  assert.equal(
    parseOdinMove({ type: 'play', cardIds: ['leaf-1'], takeId: '__proto__' }),
    null,
  )
  assert.deepEqual(parseOdinState(emptyOdinState('p0')), emptyOdinState('p0'))
  for (const value of [
    null,
    {},
    { ...e.state, current: 'outsider' },
    { ...e.state, center: [c('moon', 1), c('leaf', 2)] },
    { ...e.state, result: { winner: 'p0', entries: [null, null] } },
    { ...e.state, players: [...e.state.players, e.state.players[0]] },
  ])
    assert.doesNotThrow(() => assert.equal(parseOdinState(value), null))
})
test('500 partidas completas de 2–6 pessoas conservam todas as cartas e terminam sem softlock', () => {
  let seed = 12345
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  for (let game = 0; game < 500; game++) {
    let e = createOdinMatch(
      members(2 + (game % 5)),
      { ...defaultOdinSettings, singleHand: game % 3 === 0 },
      { random },
    )
    for (let steps = 0; steps < 3000; steps++) {
      invariant(e)
      if (e.state.phase === 'finished') break
      if (e.state.phase === 'hand-result') {
        e = advanceOdinHand(e, { random })
        continue
      }
      const hand = e.hands[e.state.current],
        plays = odinLegalPlays(hand, e.state.center)
      plays.sort(
        (a, b) =>
          b.length - a.length ||
          odinValue(hand.filter((c) => a.includes(c.id))) -
            odinValue(hand.filter((c) => b.includes(c.id))),
      )
      const move = plays.length
        ? {
            type: 'play',
            cardIds: plays[0],
            ...(e.state.center.length > 1 && plays[0].length < hand.length
              ? {
                  takeId: [...e.state.center].sort(
                    (a, b) => a.value - b.value,
                  )[0].id,
                }
              : {}),
          }
        : { type: 'pass' }
      e = applyOdinMove(e, e.state.current, move)
    }
    assert.equal(e.state.phase, 'finished', `Partida ${game} não terminou`)
  }
})
