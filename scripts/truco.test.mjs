import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyTrucoMove, createTrucoMatch, dealNextTrucoHand, emptyTrucoState, makeTrucoDeck,
  resolveTrucoHand, resolveTrucoTrick, syncTrucoMembers, trucoCanPlay, trucoCanRaise,
  trucoCanRespond, trucoCardPower, trucoExpectedSeat, trucoNextStake, trucoPaused, trucoPlayerAt,
} from '../src/games/truco.ts'
import { parseTrucoCard, parseTrucoHand, parseTrucoMove, parseTrucoState } from '../src/games/trucoWire.ts'

const members = ['A', 'B', 'C', 'D'].map((identity) => ({ identity, name: identity }))
const rng = (seed) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000
const create = (seed = 1, leader = 0) => createTrucoMatch(members, { random: rng(seed), dealerSeat: (leader + 3) % 4 })
const actor = (e) => trucoPlayerAt(e.state).identity
const play = (e, identity = actor(e), cardId = e.hands[identity][0].id) => applyTrucoMove(e, identity, { type: 'play', cardId })
const request = (e, identity = actor(e)) => applyTrucoMove(e, identity, { type: 'call-truco' })
const responders = (e) => e.state.players.filter((p) => trucoCanRespond(e.state, p.identity)).map((p) => p.identity)
const accept = (e, identity = responders(e)[0]) => applyTrucoMove(e, identity, { type: 'accept-raise' })
const refuse = (e, identity = responders(e)[0]) => applyTrucoMove(e, identity, { type: 'refuse-raise' })
const card = (id) => { const [rank, suit] = id.split('-'); return { id, rank, suit } }
const rig = (hands) => {
  const e = create()
  e.hands = Object.fromEntries(Object.entries(hands).map(([id, cards]) => [id, cards.map(card)]))
  assert.equal(new Set(Object.values(e.hands).flat().map((c) => c.id)).size, 12)
  return e
}
const integrity = (e) => {
  const s = e.state
  assert.ok(parseTrucoState(s), `snapshot válido em ${s.phase} / vaza ${s.trickIndex}`)
  assert.equal(s.currentSeat, trucoExpectedSeat(s))
  assert.equal(new Set(s.trickPlays.map((p) => p.identity)).size, s.trickPlays.length)
  const visible = [...Object.values(e.hands).flat(), ...s.lastTrick.map((p) => p.card), ...s.trickPlays.map((p) => p.card)]
  assert.equal(new Set(visible.map((c) => c.id)).size, visible.length)
  for (const p of s.players) {
    assert.equal(e.hands[p.identity].length, 3 - s.trickIndex - Number(s.trickPlays.some((play) => play.identity === p.identity)))
    assert.ok(parseTrucoHand(e.hands[p.identity]))
  }
  if (s.phase === 'playing' && !trucoPaused(s)) {
    assert.equal(s.players.filter((p) => trucoCanPlay(s, p.identity)).length, s.pendingRaise ? 0 : 1)
    assert.equal(responders(e).length, s.pendingRaise ? 2 : 0)
  }
}
const finish = (e) => { for (let i = 0; e.state.phase === 'playing'; i++) { assert.ok(i < 12); e = play(e); integrity(e) } return e }
const freeze = (value) => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }

test('40 cartas únicas, hierarquia mineira fixa e embaralhamento reproduzível só nos testes', () => {
  const deck = makeTrucoDeck(rng(1))
  assert.equal(deck.length, 40)
  assert.equal(new Set(deck.map((c) => c.id)).size, 40)
  assert.deepEqual(makeTrucoDeck(rng(1)), deck)
  assert.notDeepEqual(makeTrucoDeck(rng(2)), deck)
  const order = ['4-ouros', '5-paus', '6-copas', '7-paus', 'Q-copas', 'J-paus', 'K-ouros', 'A-paus', '2-ouros', '3-paus', '7-ouros', 'A-espadas', '7-copas', '4-paus'].map(card)
  assert.ok(order.every((c, i) => i === 0 || trucoCardPower(c) > trucoCardPower(order[i - 1])))
})
test('quatro lugares fixos, duplas alternadas e uma mão privada de três cartas por pessoa', () => {
  const e = create()
  integrity(e)
  assert.deepEqual(e.state.players.map((p) => [p.identity, p.seat, p.team]), [['A', 0, 0], ['B', 1, 1], ['C', 2, 0], ['D', 3, 1]])
  assert.equal(Object.values(e.hands).flat().length, 12)
  assert.equal(new Set(Object.values(e.hands).flat().map((c) => c.id)).size, 12)
  assert.equal(e.state.currentSeat, 0)
  assert.equal(e.state.stake, 2)
  for (const count of [0, 2, 3, 5]) assert.throws(() => createTrucoMatch(Array.from({ length: count }, (_, i) => ({ identity: `${i}`, name: `${i}` }))))
  assert.throws(() => createTrucoMatch([members[0], ...members.slice(0, 3)]))
  assert.throws(() => createTrucoMatch(members, { dealerSeat: 4 }))
})
test('toda combinação de líder, posição do pedido, cadeia até doze e parceiro respondente preserva A→B→C→D', () => {
  let scenarios = 0
  for (let leader = 0; leader < 4; leader++) for (let position = 0; position < 4; position++) {
    for (let chain = 1; chain <= 4; chain++) for (let mask = 0; mask < (1 << chain); mask++) {
      let e = create(1, leader)
      for (let i = 0; i < position; i++) e = play(e)
      const originalSeat = e.state.currentSeat, originalHands = structuredClone(e.hands), originalPlays = structuredClone(e.state.trickPlays)
      e = request(e)
      for (let increase = 1; increase < chain; increase++) {
        assert.equal(e.state.currentSeat, originalSeat)
        e = request(e, responders(e)[(mask >> (increase - 1)) & 1])
      }
      e = accept(e, responders(e)[(mask >> (chain - 1)) & 1])
      assert.equal(e.state.currentSeat, originalSeat)
      assert.equal(e.state.stake, [4, 6, 10, 12][chain - 1])
      assert.deepEqual(e.hands, originalHands, 'negociação não gasta cartas')
      assert.deepEqual(e.state.trickPlays, originalPlays)
      for (let i = position; i < 4; i++) {
        assert.equal(e.state.currentSeat, (leader + i) % 4)
        e = play(e)
        integrity(e)
      }
      assert.deepEqual(e.state.lastTrick.map((p) => p.identity), Array.from({ length: 4 }, (_, i) => members[(leader + i) % 4].identity))
      assert.ok(Object.values(e.hands).every((hand) => hand.length === 2))
      scenarios++
    }
  }
  assert.equal(scenarios, 480)
})
test('regressão: A joga, B pede truco, C pede seis, D pede dez, A aceita — ainda joga B', () => {
  let e = play(create())
  e = request(e, 'B')
  e = request(e, 'C')
  e = request(e, 'D')
  e = accept(e, 'A')
  assert.equal(actor(e), 'B')
  for (const id of ['B', 'C', 'D']) e = play(e, id)
  assert.deepEqual(e.state.lastTrick.map((p) => p.identity), ['A', 'B', 'C', 'D'])
  integrity(finish(e))
})
test('ambos os adversários podem aceitar mesmo que um já tenha jogado; a dupla solicitante não pode', () => {
  const raised = request(play(create()), 'B')
  assert.deepEqual(responders(raised), ['A', 'C'])
  assert.equal(actor(accept(raised, 'A')), 'B')
  assert.equal(actor(accept(raised, 'C')), 'B')
  for (const id of ['B', 'D', 'espectador']) assert.throws(() => accept(raised, id))
})
test('pedir/aceitar/aumentar nunca muda líder, cartas, índice da vaza ou placar', () => {
  let e = play(create())
  const before = structuredClone(e)
  for (const id of ['B', 'C', 'D', 'A']) {
    e = request(e, id)
    for (const field of ['currentSeat', 'trickLeaderSeat', 'trickIndex', 'trickPlays', 'lastTrick', 'scores']) assert.deepEqual(e.state[field], before.state[field])
    assert.deepEqual(e.hands, before.hands)
    integrity(e)
  }
  e = accept(e)
  assert.equal(actor(e), 'B')
  assert.equal(e.state.stake, 12)
})
test('só quem tem a carta da vez pode iniciar pedido, sem saltos nem aumentos seguidos da mesma dupla', () => {
  const e = create()
  for (const id of ['B', 'C', 'D', 'espectador']) assert.throws(() => request(e, id))
  let raised = request(e)
  for (const id of ['A', 'C']) assert.throws(() => request(raised, id))
  raised = accept(raised)
  assert.equal(trucoCanRaise(raised.state, 'A'), false)
  assert.throws(() => request(raised, 'A'))
  raised = play(raised)
  assert.equal(trucoCanRaise(raised.state, 'B'), true)
  raised = accept(request(raised))
  assert.equal(raised.state.stake, 6)
  assert.equal(actor(raised), 'B')
})
test('correr de truco/seis/dez/doze paga o valor já aceito, não o pedido pendente', () => {
  for (let chain = 1; chain <= 4; chain++) {
    let e = request(create())
    for (let i = 1; i < chain; i++) e = request(e, responders(e)[0])
    const winner = e.state.pendingRaise.team, value = [2, 4, 6, 10][chain - 1]
    e = refuse(e)
    assert.equal(e.state.scores[winner], value)
    assert.equal(e.state.scores[1 - winner], 0)
    assert.equal(e.state.handWinner, winner)
    assert.equal(e.state.phase, 'hand-result')
    assert.equal(e.state.pendingRaise, null)
    integrity(e)
  }
})
test('doze é o limite; fim da queda não distribui cartas nem aceita novas jogadas', () => {
  let e = request(create())
  for (let i = 0; i < 3; i++) e = request(e, responders(e)[0])
  assert.ok(e.state.players.every((p) => !trucoCanRaise(e.state, p.identity)))
  assert.throws(() => request(e, responders(e)[0]))
  e = finish(accept(e))
  assert.equal(e.state.phase, 'finished')
  assert.ok(e.state.scores.includes(12))
  assert.throws(() => dealNextTrucoHand(e))
  assert.throws(() => play(e))
  assert.deepEqual([2, 4, 6, 10, 12].map(trucoNextStake), [4, 6, 10, 12, null])
})
test('resposta repetida não reaplica aposta ou pontuação; cartas ficam bloqueadas durante negociação', () => {
  const raised = request(create())
  assert.throws(() => play(raised))
  assert.throws(() => accept(accept(raised), 'D'))
  const ran = refuse(raised)
  assert.throws(() => refuse(ran, 'D'))
  assert.deepEqual(ran.state.scores, [2, 0])
})
test('fora da vez, carta alheia, carta repetida e ator duplicado não mudam estado nem mãos', () => {
  const e = freeze(create()), snapshot = JSON.stringify(e)
  assert.throws(() => play(e, 'B'))
  assert.throws(() => play(e, 'A', e.hands.B[0].id))
  assert.throws(() => applyTrucoMove(e, 'espectador', { type: 'call-truco' }))
  const next = play(e)
  assert.throws(() => play(next, 'A'))
  assert.equal(JSON.stringify(e), snapshot)
  const invalid = structuredClone(next)
  invalid.state.currentSeat = 0
  assert.throws(() => play(invalid, 'A'))
  const skipped = structuredClone(next)
  skipped.state.trickPlays[0].identity = 'C'
  assert.throws(() => play(skipped, 'B'))
})
test('vencedor da vaza abre a próxima, sem depender da posição do jogador no array', () => {
  let e = rig({ A: ['3-paus', '5-paus', '6-paus'], B: ['4-ouros', '5-ouros', '6-ouros'], C: ['7-copas', '5-copas', '6-copas'], D: ['Q-espadas', '5-espadas', '6-espadas'] })
  e.state.players.reverse()
  for (const id of ['A', 'B', 'C', 'D']) e = play(e, id)
  assert.equal(actor(e), 'C')
  assert.deepEqual(e.state.trickWinners, [0])
  for (const id of ['C', 'D', 'A', 'B']) e = play(e, id)
  assert.deepEqual(e.state.lastTrick.map((p) => p.identity), ['C', 'D', 'A', 'B'])
  integrity(e)
})
test('duas cartas mais altas da mesma dupla vencem juntas; a primeira abre a próxima', () => {
  const e = create()
  const plays = [['A', '3-paus'], ['B', 'Q-ouros'], ['C', '3-copas'], ['D', 'J-espadas']].map(([identity, id]) => ({ identity, card: card(id) }))
  assert.deepEqual(resolveTrucoTrick(plays, e.state.players), { team: 0, seat: 0 })
  plays.push(plays.shift())
  plays.push(plays.shift())
  assert.deepEqual(resolveTrucoTrick(plays, e.state.players), { team: 0, seat: 2 })
})
test('cartas altas empatadas entre adversários cangam; em empate permanece o líder anterior', () => {
  let e = rig({ A: ['3-paus', 'Q-paus', '5-paus'], B: ['3-ouros', 'Q-ouros', '5-ouros'], C: ['2-copas', 'J-copas', '6-copas'], D: ['2-espadas', 'J-espadas', '6-espadas'] })
  for (let i = 0; i < 4; i++) e = play(e)
  assert.deepEqual(e.state.trickWinners, [null])
  assert.equal(actor(e), 'A')
  assert.equal(e.state.phase, 'playing')
  integrity(e)
})
test('tabela de empate fecha em duas ou três vazas, sem quarta vaza nem pontos inventados', () => {
  for (const [winners, complete, winner] of [
    [[], false, null], [[0], false, null], [[null], false, null],
    [[0, 0], true, 0], [[1, 1], true, 1], [[0, null], true, 0], [[1, null], true, 1],
    [[null, 0], true, 0], [[null, 1], true, 1], [[0, 1], false, null], [[1, 0], false, null], [[null, null], false, null],
    [[0, 1, null], true, 0], [[1, 0, null], true, 1], [[0, 1, 1], true, 1], [[1, 0, 0], true, 0],
    [[null, null, 1], true, 1], [[null, null, null], true, null],
  ]) assert.deepEqual(resolveTrucoHand(winners), { complete, winner })
})
test('três vazas empatadas terminam a mão sem premiar o mão e permitem nova distribuição', () => {
  let e = rig({ A: ['3-paus', 'Q-paus', '5-paus'], B: ['3-ouros', 'Q-ouros', '5-ouros'], C: ['2-copas', 'J-copas', '6-copas'], D: ['2-espadas', 'J-espadas', '6-espadas'] })
  e = finish(e)
  assert.deepEqual(e.state.trickWinners, [null, null, null])
  assert.deepEqual(e.state.scores, [0, 0])
  assert.equal(e.state.handWinner, null)
  assert.equal(e.state.phase, 'hand-result')
  const next = dealNextTrucoHand(e)
  assert.equal(next.state.phase, 'playing')
  integrity(next)
})
test('cada mão muda gameId/stepId e roda distribuidor/mão; queda, duplas e placar continuam', () => {
  let e = refuse(request(create()))
  const first = structuredClone(e)
  for (let i = 0; i < 4; i++) {
    const before = structuredClone(e)
    e = dealNextTrucoHand(e, rng(i + 1))
    assert.equal(e.state.matchId, first.state.matchId)
    assert.equal(e.state.handNumber, i + 2)
    assert.notEqual(e.state.gameId, before.state.gameId)
    assert.notEqual(e.state.stepId, before.state.stepId)
    assert.equal(e.state.dealerSeat, (before.state.dealerSeat + 1) % 4)
    assert.equal(e.state.currentSeat, (e.state.dealerSeat + 1) % 4)
    assert.deepEqual(e.state.scores, before.state.scores)
    assert.deepEqual(e.state.players, before.state.players)
    assert.equal(e.state.stake, 2)
    integrity(e)
    e = finish(e)
  }
})
test('saída de um jogador pausa cartas/respostas e a volta mantém exatamente a vez e as cartas', () => {
  const e = request(play(create()), 'B'), paused = syncTrucoMembers(e, new Set(['A', 'C', 'D']))
  assert.equal(trucoPaused(paused.state), true)
  assert.ok(paused.state.players.every((p) => !trucoCanPlay(paused.state, p.identity) && !trucoCanRespond(paused.state, p.identity)))
  assert.throws(() => accept(paused, 'C'))
  assert.deepEqual(paused.hands, e.hands)
  const resumed = syncTrucoMembers(paused, new Set(['A', 'B', 'C', 'D', 'espectador']))
  assert.deepEqual(resumed.hands, e.hands)
  assert.equal(resumed.state.currentSeat, 1)
  assert.deepEqual(resumed.state.pendingRaise, e.state.pendingRaise)
  assert.equal(actor(accept(resumed, 'C')), 'B')
  assert.equal(syncTrucoMembers(resumed, new Set(['A', 'B', 'C', 'D'])), resumed)
})
test('não distribui próxima mão com alguém ausente e não pula lugar por entrada de espectador', () => {
  const e = syncTrucoMembers(refuse(request(create())), new Set(['A', 'B', 'C', 'E']))
  assert.throws(() => dealNextTrucoHand(e))
  assert.deepEqual(e.state.players.map((p) => p.identity), ['A', 'B', 'C', 'D'])
  assert.equal(e.state.players.find((p) => p.identity === 'D').connected, false)
})
test('cada decisão válida tem id novo; transições puras também funcionam com snapshots congelados', () => {
  let e = freeze(create()), previous = e
  for (const move of [{ type: 'call-truco' }, { type: 'accept-raise' }]) {
    const id = move.type === 'call-truco' ? actor(e) : responders(e)[0]
    const snapshot = JSON.stringify(e)
    e = applyTrucoMove(e, id, move)
    assert.notEqual(e.state.stepId, previous.state.stepId)
    assert.equal(JSON.stringify(previous), snapshot)
    previous = freeze(e)
  }
  const next = play(e)
  assert.notEqual(next.state.stepId, e.state.stepId)
})
test('wire rejeita ordem pulada, cartas/atores duplicados, aposta impossível e snapshot antigo sem ids', () => {
  const e = play(create())
  assert.ok(parseTrucoState(e.state))
  for (const mutate of [
    (s) => { s.currentSeat = 2 },
    (s) => { s.trickPlays.push(s.trickPlays[0]) },
    (s) => { s.trickPlays[0].identity = 'C' },
    (s) => { s.players[1].seat = 0 },
    (s) => { s.players[1].team = 0 },
    (s) => { s.trickIndex = 1 },
    (s) => { s.pendingRaise = { identity: 'B', team: 0, targetStake: 4 } },
    (s) => { s.pendingRaise = { identity: 'B', team: 1, targetStake: 10 } },
    (s) => { s.stake = 12; s.pendingRaise = { identity: 'B', team: 1, targetStake: null } },
    (s) => { delete s.stepId },
    (s) => { s.gameId = '' },
    (s) => { s.revision = -1 },
    (s) => { s.players[0].connected = undefined },
    (s) => { s.phase = 'finished' },
  ]) { const s = structuredClone(e.state); mutate(s); assert.equal(parseTrucoState(s), null) }
  for (const junk of [null, [], 123, 'A', {}, { phase: 'playing' }]) assert.equal(parseTrucoState(junk), null)
  assert.ok(parseTrucoState(emptyTrucoState('A')))
})
test('wire só transporta cartas válidas e remove campos privados/injetados dos snapshots', () => {
  const e = create()
  const s = parseTrucoState({ ...e.state, hands: e.hands, deck: makeTrucoDeck(), future: [1, 2, 3] })
  assert.ok(s)
  assert.ok(!('hands' in s) && !('deck' in s) && !('future' in s))
  assert.equal(parseTrucoCard({ id: '3-paus', rank: '4', suit: 'paus' }), null)
  assert.equal(parseTrucoHand([e.hands.A[0], e.hands.A[0]]), null)
  assert.equal(parseTrucoHand(makeTrucoDeck().slice(0, 4)), null)
  assert.equal(parseTrucoMove({ type: 'play', cardId: '' }), null)
  assert.equal(parseTrucoMove({ type: 'hack' }), null)
  assert.deepEqual(parseTrucoMove({ type: 'play', cardId: '4-paus', identity: 'B' }), { type: 'play', cardId: '4-paus' })
})
test('500 quedas completas com pedidos, recusas e parceiros aleatórios: sem saltos, duplicação ou softlock', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const random = rng(seed)
    let e = create(seed, seed % 4), deals = 0, playedThisTrick = []
    while (e.state.phase !== 'finished') {
      assert.ok(deals++ < 100, 'queda termina')
      for (let actions = 0; e.state.phase === 'playing'; actions++) {
        assert.ok(actions < 30, 'mão termina sem softlock')
        integrity(e)
        const before = e.state
        if (before.pendingRaise) {
          const who = responders(e)[Math.floor(random() * 2)]
          e = trucoCanRaise(before, who) && random() < .4 ? request(e, who) : random() < .15 ? refuse(e, who) : accept(e, who)
          assert.equal(e.state.currentSeat, before.currentSeat)
        } else if (trucoCanRaise(before, actor(e)) && random() < .22) e = request(e)
        else {
          const who = actor(e)
          assert.ok(!playedThisTrick.includes(who), 'ninguém joga duas vezes na mesma vaza')
          playedThisTrick.push(who)
          e = play(e, who, e.hands[who][Math.floor(random() * e.hands[who].length)].id)
          if (e.state.trickIndex !== before.trickIndex) {
            assert.equal(new Set(playedThisTrick).size, 4, 'os quatro jogaram antes de resolver')
            playedThisTrick = []
          }
        }
        assert.notEqual(e.state.stepId, before.stepId)
        integrity(e)
      }
      if (e.state.phase === 'hand-result') e = dealNextTrucoHand(e, random)
      playedThisTrick = []
    }
    assert.equal(e.state.scores.filter((score) => score === 12).length, 1)
  }
})
