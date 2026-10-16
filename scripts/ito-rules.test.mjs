import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultItoSettings, isItoOrderCorrect, itoCardCounts, itoNextProgress, itoPlaceCard, itoRequiredVotes, itoRoundTopic, itoSuggestedTopics, itoTableReady, readItoSettings } from '../src/games/itoRules.ts'

test('maioria absoluta em mesas de 2 a 8; voto por pessoa, não por carta', () => {
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => itoRequiredVotes('majority', i + 2)), [2, 2, 3, 3, 4, 4, 5])
  assert.equal(itoRequiredVotes('unanimous', 5), 5)
  assert.equal(itoRequiredVotes('anyone', 5), 1)
})
test('progressão do exemplo de cinco pessoas', () => {
  assert.deepEqual(Array.from({ length: 6 }, (_, extras) => itoCardCounts(5, extras, 2)), [
    [1,1,1,1,1], [2,1,1,1,1], [2,2,1,1,1], [2,2,2,1,1], [2,2,2,2,1], [2,2,2,2,2],
  ])
})
test('todas as distribuições são equilibradas, únicas por passo e respeitam a meta', () => {
  for (let players = 2; players <= 8; players++) for (let goal = 2; goal <= 5; goal++) {
    for (let extra = 0; extra <= players * (goal - 1); extra++) {
      const counts = itoCardCounts(players, extra, goal)
      assert.equal(counts.reduce((a, b) => a + b, 0), players + extra)
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1)
      assert.ok(counts.every((n) => n >= 1 && n <= goal))
      if (extra) assert.equal(counts.filter((n, i) => n !== itoCardCounts(players, extra - 1, goal)[i]).length, 1)
    }
  }
})
test('derrotas mantêm, removem uma ou zeram as cartas extras', () => {
  assert.equal(itoNextProgress(3, false, 'keep', 5), 3)
  assert.equal(itoNextProgress(3, false, 'remove-one', 5), 2)
  assert.equal(itoNextProgress(3, false, 'reset', 5), 0)
  assert.equal(itoNextProgress(0, false, 'remove-one', 5), 0)
  assert.equal(itoNextProgress(5, true, 'reset', 5), 5)
})
test('a vitória sempre adiciona uma carta, sem ultrapassar a meta', () => {
  for (const rule of ['keep', 'remove-one', 'reset']) assert.equal(itoNextProgress(2, true, rule, 5), 3)
})
test('configurações inválidas não entram no jogo', () => {
  assert.deepEqual(readItoSettings(undefined), defaultItoSettings)
  for (const options of [null, {}, { ...defaultItoSettings, targetCards: 99 }, { ...defaultItoSettings, lossRule: 'qualquer' }, { ...defaultItoSettings, revealRule: '50%' }]) assert.equal(readItoSettings(options), null)
})
test('resultado considera cada carta individualmente, inclusive cartas da mesma pessoa', () => {
  assert.equal(isItoOrderCorrect(['a1', 'b1', 'a2'], { a1: 8, a2: 91, b1: 52 }), true)
  assert.equal(isItoOrderCorrect(['a1', 'a2', 'b1'], { a1: 8, a2: 91, b1: 52 }), false)
  assert.equal(isItoOrderCorrect(['a1', 'b1'], { a1: 8 }), false)
})
test('tema escrito pela mesa tem prioridade e é normalizado', () => {
  assert.equal(itoRoundTopic('  De rolê\n tranquilo   a \tperrengue!  '), 'De rolê tranquilo a perrengue!')
  assert.equal(itoRoundTopic('Tema do nosso grupo: 🥝 & caos'), 'Tema do nosso grupo: 🥝 & caos')
  assert.equal(itoRoundTopic('x'.repeat(150)).length, 120)
  assert.equal(itoRoundTopic('Tema da galera', '', () => { throw new Error('Não deveria sortear') }), 'Tema da galera')
})
test('sugestões só entram para tema vazio e evitam repetir a rodada anterior', () => {
  for (const topic of itoSuggestedTopics) for (let seed = 0; seed < 10; seed++) {
    const result = itoRoundTopic(' \n\t ', topic, () => seed / 10)
    assert.ok(itoSuggestedTopics.includes(result))
    assert.notEqual(result, topic)
  }
})
test('uma dica pode ocupar qualquer espaço enquanto os outros ainda estão vazios', () => {
  const slots = [null, null, null, null, null]
  assert.deepEqual(itoPlaceCard(slots, 'a', 4), [null, null, null, null, 'a'])
  assert.deepEqual(slots, [null, null, null, null, null])
  assert.equal(itoTableReady([{ id: 'a', clue: 'Alta' }, { id: 'b', clue: '' }], [null, 'a']), false)
})
test('mover uma carta para espaço vazio não duplica nem altera os demais espaços', () => {
  assert.deepEqual(itoPlaceCard(['a', null, 'c', null, 'e'], 'a', 3), [null, null, 'c', 'a', 'e'])
  const slots = ['a', 'b']
  assert.equal(itoPlaceCard(slots, 'a', 0), slots)
  for (const slot of [-1, 2, .5, NaN, Infinity]) assert.equal(itoPlaceCard(slots, 'a', slot), null)
  assert.equal(itoPlaceCard(slots, '', 0), null)
})
test('espaços ocupados trocam cartas; carta nova devolve a anterior à área de espera', () => {
  assert.deepEqual(itoPlaceCard(['a', 'b', 'c'], 'a', 2), ['c', 'b', 'a'])
  assert.deepEqual(itoPlaceCard(['a', 'b', null], 'c', 1), ['a', 'c', null])
})
test('revelação exige todas as dicas e cada carta exatamente uma vez na mesa', () => {
  const cards = [{ id: 'a', clue: 'Baixa' }, { id: 'b', clue: 'Alta' }]
  assert.equal(itoTableReady(cards, ['a', 'b']), true)
  for (const order of [['a', null], ['a', 'a'], ['a', 'c'], ['a'], []]) assert.equal(itoTableReady(cards, order), false)
  assert.equal(itoTableReady([{ id: 'a', clue: '' }, cards[1]], ['a', 'b']), false)
  assert.equal(isItoOrderCorrect([null, 'a'], { a: 80 }), false)
  assert.equal(isItoOrderCorrect(['a', null], { a: 80 }), false)
})
test('todas as posições de mesas de 2 a 40 cartas preservam a permutação nos ajustes', () => {
  for (let count = 2; count <= 40; count++) {
    const ids = Array.from({ length: count }, (_, index) => `c${index}`)
    let slots = ids.map(() => null)
    for (let index = 0; index < count; index++) slots = itoPlaceCard(slots, ids[index], count - index - 1)
    for (let from = 0; from < count; from++) for (let to = 0; to < count; to++) {
      const moved = itoPlaceCard(slots, ids[from], to)
      assert.equal(moved.length, count)
      assert.deepEqual([...moved].sort(), [...ids].sort())
    }
  }
})
