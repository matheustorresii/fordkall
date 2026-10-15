import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultItoSettings, isItoOrderCorrect, itoCardCounts, itoNextProgress, itoRequiredVotes, readItoSettings } from '../src/games/itoRules.ts'

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
