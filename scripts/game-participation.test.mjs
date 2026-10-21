import test from 'node:test'
import assert from 'node:assert/strict'
import { changeGameAttendance, emptyGameAttendance, GAME_KINDS, GAME_LIMITS, readGameAttendance } from '../src/games/gameParticipation.ts'
const people = ['a', 'b', 'c', 'd']
test('todos os nove jogos têm controle independente de participação', () => {
  assert.equal(GAME_KINDS.length, 9)
  for (const game of GAME_KINDS) {
    const before = emptyGameAttendance(), after = changeGameAttendance(before, game, 'b', 'b', false, people)
    assert.deepEqual(after[game].spectators, ['b'])
    assert.ok(GAME_KINDS.filter((kind) => kind !== game).every((kind) => after[kind].spectators.length === 0))
    assert.deepEqual(before[game].spectators, [])
    assert.ok(GAME_LIMITS[game].min >= 2 && GAME_LIMITS[game].max >= GAME_LIMITS[game].min)
  }
})
test('optout é idempotente e só a própria pessoa volta a participar', () => {
  const first = changeGameAttendance(emptyGameAttendance(), 'ito', 'a', 'a', false, people)
  const again = changeGameAttendance(first, 'ito', 'a', 'a', false, people)
  assert.deepEqual(again.ito.spectators, ['a'])
  assert.throws(() => changeGameAttendance(again, 'ito', 'b', 'a', true, people))
  assert.deepEqual(changeGameAttendance(again, 'ito', 'a', 'a', true, people).ito.spectators, [])
})
test('primeiro organizador pode retirar outros, demais jogadores e espectadores não', () => {
  const hosted = changeGameAttendance(emptyGameAttendance(), 'poker', 'a', 'b', false, people)
  assert.equal(hosted.poker.organizer, 'a')
  assert.deepEqual(hosted.poker.spectators, ['b'])
  assert.throws(() => changeGameAttendance(hosted, 'poker', 'c', 'd', false, people))
  assert.throws(() => changeGameAttendance(hosted, 'poker', 'b', 'd', false, people))
})
test('organizador que opta por assistir passa a organização a alguém elegível', () => {
  const hosted = changeGameAttendance(emptyGameAttendance(), 'kiwi', 'a', 'b', false, people)
  const left = changeGameAttendance(hosted, 'kiwi', 'a', 'a', false, people)
  assert.equal(left.kiwi.organizer, 'c')
  assert.deepEqual(left.kiwi.spectators, ['b', 'a'])
})
test('se o organizador sai da call, outro participante pode assumir sem forçar espectadores a voltar', () => {
  const hosted = changeGameAttendance(emptyGameAttendance(), 'coup', 'a', 'b', false, people)
  const continued = changeGameAttendance(hosted, 'coup', 'c', 'd', false, ['b', 'c', 'd'])
  assert.equal(continued.coup.organizer, 'c')
  assert.deepEqual(continued.coup.spectators, ['b', 'd'])
  assert.throws(() => changeGameAttendance(hosted, 'coup', 'b', 'd', false, ['b', 'c', 'd']))
})
test('participante ausente ou alvo que saiu da call não pode alterar a lista', () => {
  assert.throws(() => changeGameAttendance(emptyGameAttendance(), 'mind', 'outsider', 'a', false, people))
  assert.throws(() => changeGameAttendance(emptyGameAttendance(), 'mind', 'a', 'outsider', false, people))
})
test('wire valida todas as listas, duplicatas e organizador que também estaria assistindo', () => {
  const games = emptyGameAttendance()
  assert.deepEqual(readGameAttendance(games), games)
  for (const malformed of [null, {}, { ...games, ito: null }, { ...games, ito: { organizer: 'a', spectators: ['a'] } }, { ...games, coup: { organizer: '', spectators: ['a', 'a'] } }, { ...games, poker: { organizer: '', spectators: [null] } }]) assert.equal(readGameAttendance(malformed), null)
  const parsed = readGameAttendance(games)
  parsed.ito.spectators.push('a')
  assert.deepEqual(games.ito.spectators, [])
})
