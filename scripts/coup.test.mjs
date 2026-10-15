import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COUP_ROLES,
  COUP_ACTIONS,
  applyCoupMove,
  coupActions,
  coupBlockRoles,
  coupPrivateFor,
  coupResponders,
  createCoupMatch,
  defaultCoupSettings,
  emptyCoupState,
  expireCoupDecision,
  syncCoupMembers,
} from '../src/games/coup.ts'
import { parseCoupMove, parseCoupPrivate, parseCoupState } from '../src/games/coupWire.ts'

const rng = (seed) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000
const members = (n) => Array.from({ length: n }, (_, i) => ({ identity: `p${i}`, name: `Kiwi ${i + 1}` }))
const create = (n = 3) => createCoupMatch(members(n), { responseSeconds: 20 }, { random: () => 0, now: 1000 })
const act = (e, action, target, id = e.state.current) =>
  applyCoupMove(e, id, { type: 'act', action, ...(target ? { target } : {}) }, { now: 1000, random: rng(7) })
const move = (e, id, m) => applyCoupMove(e, id, m, { now: 1000, random: rng(7) })
const pass = (e) => {
  const step = e.state.stepId
  for (const id of coupResponders(e.state)) {
    if (e.state.stepId !== step) break
    e = move(e, id, { type: 'pass' })
  }
  return e
}
const lose = (e) =>
  move(e, e.state.loss.identity, { type: 'lose', cardId: e.hands[e.state.loss.identity][0].id })
const coins = (e, id, value) => {
  const p = e.state.players.find((p) => p.identity === id)
  e.state.treasury += p.coins - value
  p.coins = value
  return e
}
const rig = (roles) => {
  const e = create(roles.length),
    pool = [...e.deck, ...Object.values(e.hands).flat()]
  for (const [i, hand] of roles.entries())
    e.hands[`p${i}`] = hand.map(
      (role) =>
        pool.splice(
          pool.findIndex((c) => c.role === role),
          1,
        )[0],
    )
  e.deck = pool
  return e
}
const oneLife = (e, id) => {
  const p = e.state.players.find((p) => p.identity === id)
  p.revealed.push(e.hands[id].pop())
  p.influence = 1
  return e
}
const integrity = (e) => {
  const cards = [
    ...e.deck,
    ...Object.values(e.hands).flat(),
    ...e.exchange,
    ...e.state.players.flatMap((p) => p.revealed),
  ]
  assert.equal(cards.length, 15)
  assert.equal(new Set(cards.map((c) => c.id)).size, 15)
  for (const role of COUP_ROLES) assert.equal(cards.filter((c) => c.role === role).length, 3)
  assert.equal(e.state.treasury + e.state.players.reduce((s, p) => s + p.coins, 0), 50)
  assert.equal(e.state.deckCount, e.deck.length)
  for (const p of e.state.players) {
    assert.equal(p.influence, e.hands[p.identity].length)
    assert.equal(p.influence + p.revealed.length, 2)
    if (!p.influence) assert.equal(p.coins, 0)
  }
  assert.ok(parseCoupState(e.state), `public state must be valid in ${e.state.phase}`)
}

test('setup 2–6: quinze cartas opacas, três de cada papel, moedas públicas e cartas privadas', () => {
  for (let n = 2; n <= 6; n++) {
    const e = create(n)
    integrity(e)
    assert.equal(e.state.players.length, n)
    assert.ok(e.state.players.every((p) => p.influence === 2))
    assert.equal(e.deck.length, 15 - n * 2)
    assert.equal(e.state.players.find((p) => p.identity === e.state.current).coins, n === 2 ? 1 : 2)
    assert.equal(coupPrivateFor(e, 'outsider').hand.length, 0)
    assert.ok(
      Object.values(e.hands)
        .flat()
        .every((c) => /^[0-9a-f-]{36}$/.test(c.id)),
    )
    assert.ok(!JSON.stringify(e.state).includes('"hand"'))
  }
})
test('limites, membros duplicados e configurações inválidas são rejeitados', () => {
  for (const n of [0, 1, 7]) assert.throws(() => create(n))
  assert.throws(() => createCoupMatch([members(2)[0], members(2)[0]]))
  assert.throws(() => createCoupMatch(members(3), { responseSeconds: NaN }))
  assert.ok(parseCoupState(emptyCoupState('p0')))
})
test('revanche começa pelo vencedor anterior; no duelo ele recebe só 1 moeda', () => {
  const e = createCoupMatch(members(2), defaultCoupSettings, { starter: 'p1' })
  assert.equal(e.state.current, 'p1')
  assert.equal(e.state.players[1].coins, 1)
  integrity(e)
  assert.throws(() => createCoupMatch(members(3), defaultCoupSettings, { starter: 'outsider' }))
  assert.throws(() => createCoupMatch([{ identity: '__proto__', name: 'Bad' }, members(2)[1]]))
})
test('renda é imediata, sem alvo, sem bloquear/contestar; ação não muta o estado anterior', () => {
  const e = create(),
    before = structuredClone(e),
    next = act(e, 'income')
  assert.deepEqual(e, before)
  assert.equal(next.state.current, 'p1')
  assert.equal(next.state.players[0].coins, 3)
  assert.throws(() => act(e, 'income', 'p1'))
  assert.throws(() => move(e, 'p1', { type: 'challenge' }))
  assert.throws(() => move(e, 'p1', { type: 'block', role: 'duke' }))
})
test('ajuda externa pode ser bloqueada por qualquer rival, mas não contestada diretamente', () => {
  let e = act(create(), 'foreign-aid')
  assert.equal(e.state.phase, 'block-response')
  assert.throws(() => move(e, 'p1', { type: 'challenge' }))
  e = move(e, 'p2', { type: 'block', role: 'duke' })
  assert.equal(e.state.phase, 'block-challenge')
  e = pass(e)
  assert.equal(e.state.players[0].coins, 2)
  assert.equal(e.state.current, 'p1')
  integrity(e)
  const allowed = pass(act(create(), 'foreign-aid'))
  assert.equal(allowed.state.players[0].coins, 4)
})
test('taxar pode ser blefe: não exige Duque para alegar e só resolve quando todos respondem', () => {
  let e = rig([
    ['captain', 'ambassador'],
    ['duke', 'contessa'],
    ['assassin', 'duke'],
  ])
  e = act(e, 'tax')
  assert.equal(e.state.phase, 'action-response')
  e = move(e, 'p1', { type: 'pass' })
  assert.equal(e.state.phase, 'action-response')
  assert.throws(() => move(e, 'p1', { type: 'pass' }))
  e = move(e, 'p2', { type: 'pass' })
  assert.equal(e.state.players[0].coins, 5)
  integrity(e)
})
test('contestar uma alegação verdadeira exige prova, troca a carta provada e penaliza o desafiante', () => {
  let e = rig([
    ['duke', 'assassin'],
    ['captain', 'contessa'],
    ['ambassador', 'duke'],
  ])
  e = move(act(e, 'tax'), 'p1', { type: 'challenge' })
  assert.equal(e.state.phase, 'proof')
  const old = e.hands.p0.find((c) => c.role === 'duke')
  assert.throws(() => move(e, 'p0', { type: 'prove', cardId: e.hands.p0.find((c) => c.role !== 'duke').id }))
  e = move(e, 'p0', { type: 'prove', cardId: old.id })
  assert.equal(e.state.loss.identity, 'p1')
  assert.throws(() => move(e, 'p1', { type: 'lose', cardId: e.hands.p2[0].id }))
  e = lose(e)
  assert.equal(e.state.players[1].influence, 1)
  assert.equal(e.state.players[0].coins, 5)
  assert.equal(e.state.players[0].revealed.length, 0)
  assert.ok(e.state.events.some((e) => e.kind === 'proof' && e.role === 'duke'))
  integrity(e)
})
test('blefe exposto cancela a ação e quem alegou escolhe qual influência revelar', () => {
  let e = rig([
    ['captain', 'ambassador'],
    ['duke', 'contessa'],
    ['assassin', 'duke'],
  ])
  e = move(act(e, 'tax'), 'p2', { type: 'challenge' })
  assert.throws(() => move(e, 'p0', { type: 'prove', cardId: e.hands.p0[0].id }))
  e = move(e, 'p0', { type: 'concede' })
  e = lose(e)
  assert.equal(e.state.players[0].coins, 2)
  assert.equal(e.state.players[0].influence, 1)
  assert.equal(e.state.current, 'p1')
  integrity(e)
})
test('é permitido não comprovar uma carta que você realmente tem', () => {
  let e = rig([
    ['duke', 'assassin'],
    ['captain', 'contessa'],
    ['ambassador', 'duke'],
  ])
  e = move(move(act(e, 'tax'), 'p1', { type: 'challenge' }), 'p0', { type: 'concede' })
  e = lose(e)
  assert.equal(e.state.players[0].coins, 2)
  integrity(e)
})
test('golpe paga 7, não abre defesa e a vítima escolhe a influência; com 10 é obrigatório', () => {
  let e = coins(create(), 'p0', 10)
  for (const action of COUP_ACTIONS.filter((a) => a !== 'coup'))
    assert.throws(() => act(e, action, coupActions[action].targeted ? 'p1' : undefined))
  e = act(e, 'coup', 'p1')
  assert.equal(e.state.phase, 'lose-influence')
  assert.equal(e.state.players[0].coins, 3)
  assert.throws(() => move(e, 'p1', { type: 'block', role: 'contessa' }))
  e = lose(e)
  assert.equal(e.state.players[1].influence, 1)
  integrity(e)
  assert.throws(() => act(create(), 'coup', 'p1'))
})
test('roubo transfere até 2; somente a vítima pode bloquear e apenas Capitão/Embaixador', () => {
  let e = pass(act(coins(create(), 'p1', 1), 'steal', 'p1'))
  assert.equal(e.state.phase, 'block-response')
  assert.deepEqual(coupResponders(e.state), ['p1'])
  assert.throws(() => move(e, 'p2', { type: 'block', role: 'captain' }))
  assert.throws(() => move(e, 'p1', { type: 'block', role: 'duke' }))
  e = pass(e)
  assert.equal(e.state.players[0].coins, 3)
  assert.equal(e.state.players[1].coins, 0)
  integrity(e)
  for (const role of ['captain', 'ambassador']) {
    let blocked = pass(act(create(), 'steal', 'p1'))
    blocked = pass(move(blocked, 'p1', { type: 'block', role }))
    assert.equal(blocked.state.players[0].coins, 2)
    integrity(blocked)
  }
})
test('qualquer rival pode contestar um bloqueio, mesmo sem ser o autor da ação', () => {
  let e = rig([
    ['captain', 'assassin'],
    ['ambassador', 'contessa'],
    ['duke', 'duke'],
  ])
  e = move(pass(act(e, 'steal', 'p1')), 'p1', { type: 'block', role: 'ambassador' })
  e = move(e, 'p2', { type: 'challenge' })
  e = move(e, 'p1', { type: 'prove', cardId: e.hands.p1.find((c) => c.role === 'ambassador').id })
  e = lose(e)
  assert.equal(e.state.players[2].influence, 1)
  assert.equal(e.state.players[0].coins, 2)
  integrity(e)
})
test('bloqueio falso exposto permite o roubo, inclusive antes do exílio da vítima', () => {
  let e = oneLife(
    rig([
      ['captain', 'assassin'],
      ['duke', 'contessa'],
      ['ambassador', 'duke'],
    ]),
    'p1',
  )
  e = move(pass(act(e, 'steal', 'p1')), 'p1', { type: 'block', role: 'ambassador' })
  e = move(move(e, 'p0', { type: 'challenge' }), 'p1', { type: 'concede' })
  e = lose(e)
  assert.equal(e.state.players[0].coins, 4)
  assert.equal(e.state.players[1].influence, 0)
  integrity(e)
})
test('assassinato pago: bloqueio aceito conserva a taxa; blefe da ação exposto devolve a taxa', () => {
  let e = pass(act(coins(create(), 'p0', 3), 'assassinate', 'p1'))
  e = pass(move(e, 'p1', { type: 'block', role: 'contessa' }))
  assert.equal(e.state.players[0].coins, 0)
  integrity(e)
  e = coins(
    rig([
      ['duke', 'captain'],
      ['ambassador', 'contessa'],
      ['assassin', 'duke'],
    ]),
    'p0',
    3,
  )
  e = move(move(act(e, 'assassinate', 'p1'), 'p2', { type: 'challenge' }), 'p0', { type: 'concede' })
  e = lose(e)
  assert.equal(e.state.players[0].coins, 3)
  assert.equal(e.state.players[1].influence, 2)
  integrity(e)
})
test('perigo duplo: contestar Assassino verdadeiro e aceitar a ação perde duas influências', () => {
  let e = coins(
    rig([
      ['assassin', 'duke'],
      ['captain', 'contessa'],
      ['ambassador', 'duke'],
    ]),
    'p0',
    3,
  )
  e = move(act(e, 'assassinate', 'p1'), 'p1', { type: 'challenge' })
  e = move(e, 'p0', { type: 'prove', cardId: e.hands.p0.find((c) => c.role === 'assassin').id })
  e = lose(e)
  assert.equal(e.state.players[1].influence, 1)
  assert.equal(e.state.phase, 'block-response')
  e = lose(pass(e))
  assert.equal(e.state.players[1].influence, 0)
  assert.equal(e.state.current, 'p2')
  integrity(e)
})
test('perigo duplo: Condessa falsa exposta perde uma influência pela contestação e outra pelo assassinato', () => {
  let e = coins(
    rig([
      ['assassin', 'duke'],
      ['captain', 'ambassador'],
      ['contessa', 'duke'],
    ]),
    'p0',
    3,
  )
  e = move(pass(act(e, 'assassinate', 'p1')), 'p1', { type: 'block', role: 'contessa' })
  e = move(move(e, 'p2', { type: 'challenge' }), 'p1', { type: 'concede' })
  e = lose(e)
  assert.equal(e.state.phase, 'lose-influence')
  assert.equal(e.state.loss.reason, 'assassination')
  e = lose(e)
  assert.equal(e.state.players[1].influence, 0)
  integrity(e)
})
test('Embaixador compra 2 privadas e devolve exatamente 2, com uma ou duas influências', () => {
  for (const remaining of [1, 2]) {
    let e = create()
    if (remaining === 1) e = oneLife(e, 'p0')
    e = pass(act(e, 'exchange'))
    assert.equal(e.state.phase, 'exchange')
    assert.equal(e.exchange.length, 2)
    assert.equal(coupPrivateFor(e, 'p1').exchange.length, 0)
    assert.equal(coupPrivateFor(e, 'p0').exchange.length, 2)
    assert.throws(() => move(e, 'p0', { type: 'exchange', keep: [] }))
    assert.throws(() => move(e, 'p0', { type: 'exchange', keep: ['fake'] }))
    const pool = [...e.hands.p0, ...e.exchange]
    e = move(e, 'p0', { type: 'exchange', keep: pool.slice(-remaining).map((c) => c.id) })
    assert.equal(e.hands.p0.length, remaining)
    assert.equal(e.exchange.length, 0)
    integrity(e)
  }
})
test('última influência termina a partida; eliminados devolvem moedas e não podem agir', () => {
  let e = coins(oneLife(create(2), 'p1'), 'p0', 7)
  e = lose(act(e, 'coup', 'p1'))
  assert.equal(e.state.phase, 'finished')
  assert.equal(e.state.winner, 'p0')
  assert.equal(e.state.players[1].coins, 0)
  assert.throws(() => act(e, 'income', undefined, 'p1'))
  integrity(e)
})
test('timeouts aceitam reações, provam quando possível e resolvem escolhas sem travar a mesa', () => {
  let e = act(create(), 'tax')
  assert.throws(() => expireCoupDecision(e, { now: 2000 }))
  e = expireCoupDecision(e, { now: 100000 })
  assert.equal(e.state.phase, 'turn')
  integrity(e)
  e = rig([
    ['duke', 'assassin'],
    ['captain', 'contessa'],
    ['ambassador', 'duke'],
  ])
  e = move(act(e, 'tax'), 'p1', { type: 'challenge' })
  e = expireCoupDecision(e, { now: 100000 })
  assert.equal(e.state.phase, 'lose-influence')
  e = expireCoupDecision(e, { now: 200000 })
  integrity(e)
  e = pass(act(create(), 'exchange'))
  e = expireCoupDecision(e, { now: 100000 })
  assert.equal(e.state.phase, 'turn')
  integrity(e)
})
test('saída em cada etapa elimina só quem saiu e não deixa decisões penduradas', () => {
  const stages = [
    act(create(), 'tax'),
    pass(act(create(), 'exchange')),
    act(coins(create(), 'p0', 7), 'coup', 'p1'),
  ]
  for (const e of stages)
    for (const id of ['p0', 'p1', 'p2']) {
      const next = syncCoupMembers(e, new Set(['p0', 'p1', 'p2'].filter((p) => p !== id)), { now: 1000 })
      assert.equal(next.state.players.find((p) => p.identity === id).influence, 0)
      integrity(next)
      if (id === 'p0') assert.equal(next.state.phase, 'turn')
    }
  const ended = syncCoupMembers(create(), new Set(['p2']), { now: 1000 })
  assert.equal(ended.state.winner, 'p2')
  integrity(ended)
})
test('wire parser ignora campos secretos, rejeita payload inválido e não aceita papéis inventados', () => {
  const e = create(),
    raw = { ...e.state, deck: e.deck, hands: e.hands }
  const state = parseCoupState(raw)
  assert.ok(state)
  assert.ok(!('deck' in state))
  assert.ok(!('hands' in state))
  assert.equal(parseCoupState({ ...e.state, treasury: 500 }), null)
  assert.equal(parseCoupMove({ type: 'act', action: 'constructor' }), null)
  assert.equal(parseCoupMove({ type: 'block', role: 'inquisitor' }), null)
  assert.equal(parseCoupMove({ type: 'exchange', keep: ['same', 'same'] }), null)
  assert.equal(parseCoupPrivate({ hand: [e.hands.p0[0], e.hands.p0[0]], exchange: [] }), null)
  assert.equal(parseCoupState({ ...e.state, players: [e.state.players[0], e.state.players[0]] }), null)
})
test('300 partidas aleatórias de 2–6: cartas, 50 moedas, privacidade, fases válidas e conclusão', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const random = rng(seed),
      n = 2 + (seed % 5)
    let e = createCoupMatch(members(n), defaultCoupSettings, { random, now: 1000 })
    for (let step = 0; e.state.phase !== 'finished' && step < 1500; step++) {
      integrity(e)
      const s = e.state,
        p = s.pending
      if (s.phase === 'turn') {
        const who = s.players.find((p) => p.identity === s.current)
        const actions = COUP_ACTIONS.filter(
          (a) => who.coins >= coupActions[a].cost && (who.coins < 10 || a === 'coup'),
        )
        const action = actions[Math.floor(random() * actions.length)]
        const targets = s.players.filter((p) => p.influence && p.identity !== who.identity)
        e = act(
          e,
          action,
          coupActions[action].targeted ? targets[Math.floor(random() * targets.length)].identity : undefined,
        )
      } else if (['action-response', 'block-challenge', 'block-response'].includes(s.phase)) {
        const id = coupResponders(s)[0]
        assert.ok(id, `empty response window in ${s.phase}`)
        e = move(
          e,
          id,
          s.phase === 'block-response' && random() < 0.4
            ? { type: 'block', role: coupBlockRoles(p.action)[0] }
            : s.phase !== 'block-response' && random() < 0.25
              ? { type: 'challenge' }
              : { type: 'pass' },
        )
      } else if (s.phase === 'proof') {
        const id = p.claim === 'block' ? p.blocker : p.actor,
          role = p.claim === 'block' ? p.blockRole : coupActions[p.action].role
        const card = e.hands[id].find((c) => c.role === role)
        e = move(e, id, card ? { type: 'prove', cardId: card.id } : { type: 'concede' })
      } else if (s.phase === 'lose-influence') e = lose(e)
      else if (s.phase === 'exchange')
        e = move(e, p.actor, {
          type: 'exchange',
          keep: [...e.exchange, ...e.hands[p.actor]].slice(0, e.hands[p.actor].length).map((c) => c.id),
        })
      else assert.fail(`unexpected phase ${s.phase}`)
    }
    integrity(e)
    assert.equal(e.state.phase, 'finished', `seed ${seed} must finish`)
  }
})
