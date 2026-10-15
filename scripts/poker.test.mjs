import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyPokerAction,
  createPokerMatch,
  dealPokerHand,
  defaultPokerSettings,
  describePokerHand,
  evaluatePokerFive,
  evaluatePokerHand,
  makePokerDeck,
  pokerLegalActions,
  pokerPotTotal,
  readPokerSettings,
  settlePokerPots,
  syncPokerMembers,
} from '../src/games/poker.ts'

const cards = (text) => text.split(' ')
const members = (count) => Array.from({ length: count }, (_, i) => ({ identity: `p${i}`, name: `Pessoa ${i}` }))
const seeded = (seed) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 0x100000000
}
const chips = ({ state }) => state.players.reduce((n, p) => n + p.stack + p.committed, 0)
const passive = (engine) => {
  let next = engine,
    actions = 0
  while (next.state.phase === 'playing') {
    assert.ok(actions++ < 100, 'a mão deve terminar')
    const legal = pokerLegalActions(next.state, next.state.current)
    next = applyPokerAction(next, next.state.current, { type: legal.canCheck ? 'check' : 'call' })
  }
  return next
}
test('baralho tem 52 cartas únicas; embaralhamento determinístico só é injetado nos testes', () => {
  const deck = makePokerDeck(seeded(1))
  assert.equal(deck.length, 52)
  assert.equal(new Set(deck).size, 52)
  assert.deepEqual(makePokerDeck(seeded(1)), deck)
  assert.notDeepEqual(makePokerDeck(seeded(2)), deck)
})
test('todas as nove categorias, sequência A–5 e desempate por kicker', () => {
  const examples = [
    'As Kd Qc Jh 9s',
    'As Ad Kc Qh 9s',
    'As Ad Kc Kh 9s',
    'As Ad Ac Kh 9s',
    'As 2d 3c 4h 5s',
    'As Js 8s 4s 2s',
    'As Ad Ac Kh Ks',
    'As Ad Ac Ah Ks',
    '9s Ts Js Qs Ks',
  ]
  const hands = examples.map((s) => evaluatePokerFive(cards(s)))
  assert.deepEqual(
    hands.map((h) => h.category),
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
  )
  assert.ok(hands.every((h, i) => !i || h.score > hands[i - 1].score))
  assert.ok(evaluatePokerFive(cards('2s 3h 4d 5s 6c')).score > hands[4].score)
  assert.ok(evaluatePokerFive(cards('As Ad Kc Qh 9s')).score > evaluatePokerFive(cards('As Ad Kc Qh 8s')).score)
  assert.equal(evaluatePokerFive(cards('As Ad Kc Qh 9s')).score, evaluatePokerFive(cards('Ah Ac Kd Qs 9c')).score)
  assert.throws(() => evaluatePokerHand(cards('As As Kc Qh 9s')))
  assert.throws(() => evaluatePokerFive(cards('As Ad Kc Qh Xs')))
})
test('melhor combinação de sete; pode jogar só o board e dois trincas viram full house', () => {
  assert.equal(evaluatePokerHand(cards('2s 3h As Ks Qs Js Ts')).name, 'Royal flush')
  assert.equal(evaluatePokerHand(cards('As Ad Ac Ks Kd Kc 2s')).category, 6)
  assert.equal(evaluatePokerHand(cards('As 2d 3c 4h 5s 9h Td')).category, 4)
})
test('leitura local funciona antes do flop e marca só a carta alta ou o par', () => {
  assert.deepEqual(describePokerHand(cards('Ks Ad'), []), {
    category: 0,
    name: 'Carta alta',
    cards: ['Ad'],
  })
  assert.deepEqual(describePokerHand(cards('Qs Qd'), []), {
    category: 1,
    name: 'Um par',
    cards: ['Qs', 'Qd'],
  })
})
test('leitura local acompanha par → dois pares → full house e preserva os destaques antes do river', () => {
  const hole = Object.freeze(cards('Qs 6c')),
    board = Object.freeze(cards('Qh 9d 2s 9s Qc'))
  const flop = describePokerHand(hole, board.slice(0, 3)),
    turn = describePokerHand(hole, board.slice(0, 4)),
    river = describePokerHand(hole, board)
  assert.equal(flop.name, 'Um par')
  assert.deepEqual(new Set(flop.cards), new Set(cards('Qs Qh')))
  assert.equal(turn.name, 'Dois pares')
  assert.deepEqual(new Set(turn.cards), new Set(cards('Qs Qh 9d 9s')))
  assert.equal(river.name, 'Full house')
  assert.deepEqual(new Set(river.cards), new Set(cards('Qs Qh Qc 9d 9s')))
  assert.deepEqual(hole, cards('Qs 6c'), 'não modifica a mão privada')
  assert.deepEqual(board, cards('Qh 9d 2s 9s Qc'), 'não modifica o board público')
})
test('borda da combinação cobre todas as categorias e não confunde draws com mãos prontas', () => {
  const examples = [
    ['As 7c', 'Kd Qh 2s', 'Carta alta', 'As'],
    ['As 7c', 'Kd Kh 2s', 'Um par', 'Kd Kh'],
    ['As Ad', 'Kh Kc 9h 9s 2h', 'Dois pares', 'As Ad Kh Kc 9h'],
    ['As Ad', 'Ac Kh 9s', 'Trinca', 'As Ad Ac'],
    ['As 2d', '3c 4h 5s 9h Td', 'Sequência', 'As 2d 3c 4h 5s'],
    ['7h 3h', 'Ah Kh Jh Qh 2s', 'Flush', '7h Ah Kh Jh Qh'],
    ['As Ad', 'Ac Ks Kd Kc 2s', 'Full house', 'As Ad Ac Ks Kd'],
    ['As Ad', 'Ac Ah Ks', 'Quadra', 'As Ad Ac Ah'],
    ['9s Ts', 'Js Qs Ks 2h 3c', 'Straight flush', '9s Ts Js Qs Ks'],
    ['2d 3c', 'As Ks Qs Js Ts', 'Royal flush', 'As Ks Qs Js Ts'],
    ['Ah Kh', 'Qh Jh 2s', 'Carta alta', 'Ah'],
    ['2d 3c', 'As 5h 7c 9d Kh', 'Carta alta', 'As 5h 7c 9d Kh'],
  ]
  for (const [hole, board, name, highlighted] of examples) {
    const readout = describePokerHand(cards(hole), cards(board))
    assert.equal(readout.name, name, `${hole} + ${board}`)
    assert.deepEqual(new Set(readout.cards), new Set(cards(highlighted)), `${name}: cartas corretas para esta etapa`)
    assert.equal(readout.category, evaluatePokerHand(cards(`${hole} ${board}`)).category)
  }
})
test('no river, AAKKQ supera AAKK9 e a borda inclui exatamente o kicker que desempata', () => {
  const board = cards('As Ad Kc 3h Kh'),
    queens = describePokerHand(cards('Qs Jh'), board),
    nines = describePokerHand(cards('9s 9d'), board)
  assert.equal(queens.name, 'Dois pares')
  assert.equal(nines.name, 'Dois pares')
  assert.deepEqual(new Set(queens.cards), new Set(cards('As Ad Kc Kh Qs')))
  assert.deepEqual(new Set(nines.cards), new Set(cards('As Ad Kc Kh 9s')))
  assert.ok(evaluatePokerFive(queens.cards).score > evaluatePokerFive(nines.cards).score)
})
test('somente no river, carta alta, par, trinca e quadra incluem os kickers na borda', () => {
  const examples = [
    ['As 7c', 'Kd Qh 2s 4d 9c', 'Carta alta'],
    ['As Ad', 'Kd Qh 2s 4d 9c', 'Um par'],
    ['As Ad', 'Ac Qh 2s 4d 9c', 'Trinca'],
    ['As Ad', 'Ac Ah 2s 4d 9c', 'Quadra'],
  ]
  for (const [hole, board, name] of examples) {
    const own = cards(hole),
      community = cards(board),
      river = describePokerHand(own, community)
    assert.equal(river.name, name)
    assert.equal(river.cards.length, 5)
    assert.deepEqual(river.cards, evaluatePokerHand([...own, ...community]).cards)
    for (const count of [3, 4]) {
      const before = describePokerHand(own, community.slice(0, count))
      assert.equal(before.name, name)
      assert.equal(before.cards.length, { 'Carta alta': 1, 'Um par': 2, Trinca: 3, Quadra: 4 }[name])
    }
  }
})
test('as cinco melhores no river podem usar nenhuma, uma ou duas cartas privadas', () => {
  const examples = [
    ['2d 3c', 'As Ks Qs Js Ts', 0],
    ['Qs Jh', 'As Ad Kc 3h Kh', 1],
    ['As Ad', 'Ac Kh Ks 2d 3c', 2],
  ]
  for (const [hole, board, privateCount] of examples) {
    const own = cards(hole),
      community = cards(board),
      readout = describePokerHand(own, community)
    assert.equal(readout.cards.length, 5)
    assert.equal(readout.cards.filter((card) => own.includes(card)).length, privateCount)
    assert.deepEqual(readout.cards, evaluatePokerHand([...own, ...community]).cards)
  }
})
test('leitura local não tenta avaliar cartas ausentes, repetidas ou um board parcial inválido', () => {
  for (const [hole, board] of [
    [[], []],
    [['As'], []],
    [cards('As Ad Ac'), []],
    [cards('As As'), []],
    [cards('As Xd'), []],
    [cards('As Ad'), cards('As Kd Qh')],
    [cards('As Ad'), ['Kh']],
    [cards('As Ad'), cards('Kh Qd')],
    [cards('As Ad'), cards('Kh Qd Jh Ts 9c 8s')],
  ])
    assert.equal(describePokerHand(hole, board), null)
})
test('todas as 2.598.960 mãos de cinco cartas têm a distribuição exata das categorias', () => {
  const deck = makePokerDeck(seeded(7)),
    categories = Array(9).fill(0)
  for (let a = 0; a < 48; a++)
    for (let b = a + 1; b < 49; b++)
      for (let c = b + 1; c < 50; c++)
        for (let d = c + 1; d < 51; d++)
          for (let e = d + 1; e < 52; e++)
            categories[evaluatePokerFive([deck[a], deck[b], deck[c], deck[d], deck[e]]).category]++
  assert.deepEqual(categories, [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40])
})
test('configurações e capacidade rejeitam entrada inválida', () => {
  assert.deepEqual(readPokerSettings(undefined), defaultPokerSettings)
  for (const settings of [
    null,
    {},
    { ...defaultPokerSettings, bigBlind: 3 },
    { ...defaultPokerSettings, turnSeconds: 1 },
    { ...defaultPokerSettings, startingStack: 99 },
  ])
    assert.equal(readPokerSettings(settings), null)
  assert.throws(() => createPokerMatch(members(1)))
  assert.throws(() => createPokerMatch(members(7)))
  assert.throws(() => createPokerMatch([members(2)[0], members(2)[0]]))
})
test('heads-up: dealer é small blind e joga antes no preflop, por último no flop', () => {
  let e = createPokerMatch(members(2), undefined, seeded(0))
  assert.equal(e.state.current, e.state.dealer)
  assert.equal(e.state.smallBlind, e.state.dealer)
  e = applyPokerAction(e, e.state.current, { type: 'call' })
  assert.equal(e.state.current, e.state.bigBlind, 'BB tem opção mesmo após limp')
  e = applyPokerAction(e, e.state.current, { type: 'check' })
  assert.equal(e.state.street, 'flop')
  assert.equal(e.state.current, e.state.bigBlind)
  assert.equal(e.state.board.length, 3)
  e = passive(e)
  const dealer = e.state.dealer,
    match = e.state.matchId,
    hand = e.state.gameId
  const next = dealPokerHand(e, seeded(2))
  assert.notEqual(next.state.dealer, dealer)
  assert.notEqual(next.state.gameId, hand)
  assert.equal(next.state.matchId, match)
})
test('preflop de seis começa depois do BB; fold não revela cartas nem altera o estado anterior', () => {
  const before = createPokerMatch(members(6), undefined, seeded(0)),
    snapshot = JSON.stringify(before)
  const dealerIndex = before.state.players.findIndex((p) => p.identity === before.state.dealer)
  assert.equal(before.state.current, before.state.players[(dealerIndex + 3) % 6].identity)
  let e = before
  for (let i = 0; i < 5; i++) e = applyPokerAction(e, e.state.current, { type: 'fold' })
  assert.equal(e.state.phase, 'hand-result')
  assert.equal(e.state.result.uncontested, true)
  assert.deepEqual(e.state.revealed, {})
  assert.equal(chips(e), 6000)
  assert.equal(JSON.stringify(before), snapshot)
  assert.equal(
    Object.values(e.state.result.payouts).reduce((a, b) => a + b, 0),
    10,
  )
  assert.throws(() => dealPokerHand(before))
})
test('check ilegal, fora da vez, aumento abaixo do mínimo e número fracionário são rejeitados', () => {
  const e = createPokerMatch(members(3), undefined, seeded(0)),
    id = e.state.current
  assert.throws(() => applyPokerAction(e, id, { type: 'check' }))
  assert.throws(() => applyPokerAction(e, e.state.bigBlind, { type: 'fold' }))
  assert.throws(() => applyPokerAction(e, id, { type: 'raise', total: 19 }))
  assert.throws(() => applyPokerAction(e, id, { type: 'raise', total: 20.5 }))
  const next = applyPokerAction(e, id, { type: 'raise', total: 30 })
  assert.equal(pokerLegalActions(next.state, next.state.current).minRaise, 50)
})
test('all-in curto não reabre aumento a quem já agiu; aumento completo reabre', () => {
  let e = createPokerMatch(members(3), undefined, seeded(0))
  const first = e.state.current,
    second = e.state.smallBlind,
    third = e.state.bigBlind
  e.state.players.find((p) => p.identity === second).stack = 25 // total 30; raise inicial será 20
  e = applyPokerAction(e, first, { type: 'raise', total: 20 })
  e = applyPokerAction(e, second, { type: 'all-in' })
  e = applyPokerAction(e, third, { type: 'call' })
  assert.equal(e.state.current, first)
  assert.equal(pokerLegalActions(e.state, first).canRaise, true, 'raise de 20 para 30 é completo (10)')
  // Agora um aumento inicial de 30 tem incremento de 20; all-in 40 é curto.
  e = createPokerMatch(members(3), undefined, seeded(0))
  e.state.players.find((p) => p.identity === second).stack = 35
  e = applyPokerAction(e, first, { type: 'raise', total: 30 })
  e = applyPokerAction(e, second, { type: 'all-in' })
  e = applyPokerAction(e, third, { type: 'call' })
  assert.equal(pokerLegalActions(e.state, first).canRaise, false)
  assert.equal(pokerLegalActions(e.state, first).canAllIn, false)
  assert.throws(() => applyPokerAction(e, first, { type: 'all-in' }))
  e = applyPokerAction(e, first, { type: 'call' })
  assert.equal(e.state.street, 'flop')
})
test('all-ins curtos cumulativos reabrem ao alcançar um aumento completo', () => {
  let e = createPokerMatch(members(4), undefined, seeded(0))
  const ids = [...e.state.pending],
    first = ids[0]
  e.state.players.find((p) => p.identity === ids[1]).stack =
    140 - e.state.players.find((p) => p.identity === ids[1]).bet
  e.state.players.find((p) => p.identity === ids[2]).stack =
    200 - e.state.players.find((p) => p.identity === ids[2]).bet
  e = applyPokerAction(e, first, { type: 'raise', total: 100 }) // incremento 90
  e = applyPokerAction(e, ids[1], { type: 'all-in' })
  e = applyPokerAction(e, ids[2], { type: 'all-in' })
  e = applyPokerAction(e, ids[3], { type: 'call' })
  assert.equal(e.state.current, first)
  assert.equal(pokerLegalActions(e.state, first).canRaise, true)
})
const contributor = (id, committed, folded = false) => ({
  identity: id,
  name: id,
  stack: 0,
  committed,
  bet: committed,
  inHand: true,
  folded,
  allIn: true,
  away: false,
  actedAt: null,
  action: '',
})
test('três níveis de side pots, mãos diferentes ganham cada um', () => {
  const players = [contributor('a', 100), contributor('b', 200), contributor('c', 500), contributor('d', 500)]
  const result = settlePokerPots(
    players,
    cards('2s 3h 8d 9c Ts'),
    { a: cards('Js Qh'), b: cards('As Ah'), c: cards('Ks Kh'), d: cards('Qs Qd') },
    'd',
  )
  assert.deepEqual(
    result.pots.map((p) => p.amount),
    [400, 300, 600],
  )
  assert.deepEqual(result.payouts, { a: 400, b: 300, c: 600 })
})
test('empate ignora naipe; ficha ímpar vai para o vencedor à esquerda do dealer', () => {
  const players = [contributor('a', 5), contributor('b', 5), contributor('c', 5, true)]
  const result = settlePokerPots(players, cards('As Ks Qs Js Ts'), { a: cards('2h 3h'), b: cards('4h 5h') }, 'a')
  assert.deepEqual(result.payouts, { b: 8, a: 7 })
})
test('aposta não paga volta ao dono e all-in corre o board sem pedir ações extras', () => {
  let e = createPokerMatch(members(2), undefined, seeded(0)),
    first = e.state.current
  const other = e.state.players.find((p) => p.identity !== first)
  other.stack = 90 // BB10 + 90
  const total = chips(e)
  e = applyPokerAction(e, first, { type: 'all-in' })
  e = applyPokerAction(e, e.state.current, { type: 'call' })
  assert.notEqual(e.state.phase, 'playing')
  assert.equal(e.state.board.length, 5)
  assert.equal(chips(e), total)
  assert.equal(e.state.result.refunds[first], 900)
  assert.equal(
    Object.values(e.state.result.payouts).reduce((a, b) => a + b, 0),
    200,
  )
})
test('BB curto não reduz o bring-in; uma aposta de all-in abaixo do BB não reabre o check', () => {
  let e = createPokerMatch(members(3), undefined, seeded(0))
  e = passive(e)
  // Coloca quem será o próximo BB com apenas três fichas.
  const dealer = e.state.players[(e.state.players.findIndex((p) => p.identity === e.state.dealer) + 1) % 3].identity
  const short = e.state.players[(e.state.players.findIndex((p) => p.identity === dealer) + 2) % 3]
  short.stack = 3
  e = dealPokerHand(e, seeded(2))
  assert.equal(e.state.players.find((p) => p.identity === e.state.bigBlind).bet, 3)
  assert.equal(e.state.currentBet, 10)
  assert.equal(pokerLegalActions(e.state, e.state.current).minRaise, 20)
  let flop = createPokerMatch(members(3), undefined, seeded(0))
  while (flop.state.street === 'preflop')
    flop = applyPokerAction(flop, flop.state.current, {
      type: pokerLegalActions(flop.state, flop.state.current).canCheck ? 'check' : 'call',
    })
  const checked = flop.state.current
  flop = applyPokerAction(flop, checked, { type: 'check' })
  flop.state.players.find((p) => p.identity === flop.state.current).stack = 5
  flop = applyPokerAction(flop, flop.state.current, { type: 'all-in' })
  assert.equal(pokerLegalActions(flop.state, flop.state.current).minRaise, 15)
  flop = applyPokerAction(flop, flop.state.current, { type: 'call' })
  assert.equal(flop.state.current, checked)
  assert.equal(pokerLegalActions(flop.state, checked).canRaise, false)
})
test('cem partidas de várias mãos mantêm o saldo e giram o dealer apenas entre quem tem fichas', () => {
  const random = seeded(1293)
  for (let match = 0; match < 100; match++) {
    const count = 2 + (match % 5)
    let e = createPokerMatch(members(count), { startingStack: 100, bigBlind: 10, turnSeconds: 0 }, random)
    for (let hand = 0; hand < 30; hand++) {
      let steps = 0
      while (e.state.phase === 'playing') {
        assert.ok(steps++ < 150)
        const legal = pokerLegalActions(e.state, e.state.current)
        e = applyPokerAction(e, e.state.current, {
          type: random() < 0.35 && legal.canAllIn ? 'all-in' : legal.canCheck ? 'check' : 'call',
        })
      }
      assert.equal(chips(e), count * 100)
      if (e.state.phase === 'finished') break
      const dealer = e.state.dealer,
        eligible = e.state.players.filter((p) => p.stack > 0).map((p) => p.identity)
      e = dealPokerHand(e, random)
      assert.notEqual(e.state.dealer, dealer)
      assert.ok(eligible.includes(e.state.dealer))
    }
  }
})
test('saídas, all-in desconectado e nenhuma pessoa restante não travam a mesa', () => {
  const e = createPokerMatch(members(3), undefined, seeded(0)),
    total = chips(e)
  const noOne = syncPokerMembers(e, new Set())
  assert.equal(noOne.state.phase, 'finished')
  assert.equal(chips(noOne), total)
  let all = applyPokerAction(e, e.state.current, { type: 'all-in' })
  const allId = all.state.players.find((p) => p.allIn).identity
  all = syncPokerMembers(all, new Set(all.state.players.filter((p) => p.identity !== allId).map((p) => p.identity)))
  assert.equal(all.state.players.find((p) => p.identity === allId).folded, false)
  all = passive(all)
  assert.equal(chips(all), total)
  const sameTurn = syncPokerMembers(e, new Set(e.state.players.map((p) => p.identity)))
  assert.equal(sameTurn.state.turnId, e.state.turnId)
  assert.equal(sameTurn.state.turnExpiresAt, e.state.turnExpiresAt)
})
test('1.000 mãos aleatórias de 2–6 pessoas: fichas conservadas, cartas únicas, nenhuma mesa travada', () => {
  const random = seeded(934856)
  for (let game = 0; game < 1000; game++) {
    const count = 2 + (game % 5)
    let e = createPokerMatch(members(count), undefined, random),
      steps = 0
    // Uneven stacks exercise calls, short all-ins, side pots and uncalled returns.
    e.state.players.forEach((p) => {
      p.stack = 10 + Math.floor(random() * 1000)
    })
    const total = chips(e)
    while (e.state.phase === 'playing') {
      assert.ok(steps++ < 200)
      const legal = pokerLegalActions(e.state, e.state.current),
        roll = random()
      const action =
        roll < 0.12
          ? { type: 'fold' }
          : roll < 0.28 && legal.canAllIn
            ? { type: 'all-in' }
            : roll < 0.45 && legal.canRaise && legal.maxTotal >= legal.minRaise
              ? { type: 'raise', total: legal.minRaise + Math.floor(random() * (legal.maxTotal - legal.minRaise + 1)) }
              : { type: legal.canCheck ? 'check' : 'call' }
      const previous = JSON.stringify(e)
      const next = applyPokerAction(e, e.state.current, action)
      assert.equal(JSON.stringify(e), previous)
      e = next
      assert.equal(chips(e), total)
      assert.ok(e.state.players.every((p) => p.stack >= 0 && p.bet >= 0 && p.committed >= p.bet))
      const visible = [...Object.values(e.hands).flat(), ...e.state.board, ...e.deck]
      assert.equal(new Set(visible).size, visible.length)
    }
    assert.equal(pokerPotTotal(e.state), 0)
    assert.equal(
      Object.values(e.state.result.payouts).reduce((a, b) => a + b, 0),
      e.state.result.pots.reduce((n, p) => n + p.amount, 0),
    )
    assert.ok(
      Object.values(e.state.result.payouts).reduce((a, b) => a + b, 0) +
        Object.values(e.state.result.refunds).reduce((a, b) => a + b, 0) <=
        total,
    )
    for (const pot of e.state.result.pots)
      for (const winner of pot.winners) assert.equal(e.state.players.find((p) => p.identity === winner).folded, false)
  }
})
