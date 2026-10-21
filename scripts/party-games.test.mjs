import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createImpostor,
  moveImpostor,
  syncImpostor,
  defaultImpostorSettings,
  parseImpostorState,
  majority,
  createGartic,
  moveGartic,
  syncGartic,
  defaultGarticSettings,
  parseGarticState,
  readGarticSettings,
  readImpostorSettings,
} from '../src/games/partyGames.ts'
const players = Array.from({ length: 5 }, (_, i) => ({
  identity: `p${i}`,
  name: `Jogador ${i}`,
}))
test('impostor: exactly one alternate word and no public secret before result', () => {
  const e = createImpostor('p0', players, defaultImpostorSettings)
  assert.equal(
    Object.values(e.secrets).filter((s) => s.word === e.otherWord).length,
    1,
  )
  assert.equal(
    Object.values(e.secrets).filter((s) => s.word === e.word).length,
    4,
  )
  assert.ok(!JSON.stringify(e.state).includes(e.word))
  assert.equal(e.state.result, null)
  assert.ok(parseImpostorState(e.state))
})
test('explicit impostor mode hides the word from the impostor', () => {
  const e = createImpostor('p0', players, {
    ...defaultImpostorSettings,
    mode: 'impostor',
  })
  assert.equal(e.secrets[e.impostor].word, 'IMPOSTOR')
})
test('absolute majority, toggle and duplicate requests do not inflate votes', () => {
  let e = createImpostor('p0', players, defaultImpostorSettings)
  assert.equal(majority(5), 3)
  for (const who of ['p0', 'p1'])
    e = moveImpostor(e, who, { type: 'request-vote' })
  assert.equal(e.state.phase, 'talk')
  e = moveImpostor(e, 'p1', { type: 'request-vote' })
  assert.equal(e.state.requests.length, 1)
  e = moveImpostor(e, 'p1', { type: 'request-vote' })
  e = moveImpostor(e, 'p2', { type: 'request-vote' })
  assert.equal(e.state.phase, 'vote')
})
test('ballots stay private until all players vote, then reveal the full tally', () => {
  let e = createImpostor('p0', players, defaultImpostorSettings)
  for (let i = 0; i < 3; i++)
    e = moveImpostor(e, `p${i}`, { type: 'request-vote' })
  for (let i = 0; i < 4; i++)
    e = moveImpostor(e, `p${i}`, { type: 'vote', target: e.impostor })
  assert.equal(e.state.result, null)
  assert.equal('ballots' in e.state, false)
  e = moveImpostor(e, 'p4', { type: 'vote', target: e.impostor })
  assert.equal(e.state.result.caught, true)
  assert.equal(e.state.result.counts[e.impostor], 5)
  assert.ok(parseImpostorState(e.state))
})
test('a tied vote has no false accused winner; custom word pairs are validated', () => {
  let e = createImpostor('p0', players.slice(0, 4), {
    ...defaultImpostorSettings,
    customPairs: 'Homem de Ferro | Homem-Aranha',
  })
  for (let i = 0; i < 3; i++)
    e = moveImpostor(e, `p${i}`, { type: 'request-vote' })
  for (let i = 0; i < 4; i++)
    e = moveImpostor(e, `p${i}`, { type: 'vote', target: i < 2 ? 'p0' : 'p1' })
  assert.equal(e.state.result.accused.length, 2)
  assert.equal(e.state.result.caught, false)
  assert.throws(() =>
    createImpostor('p0', players, {
      ...defaultImpostorSettings,
      customPairs: 'inválido',
    }),
  )
})
test('spectators cannot request or vote; an absent impostor ends the round', () => {
  const e = createImpostor('p0', players, defaultImpostorSettings)
  assert.throws(() => moveImpostor(e, 'outsider', { type: 'request-vote' }))
  assert.equal(
    syncImpostor(
      e,
      players.filter((p) => p.identity !== e.impostor),
    ).state.phase,
    'result',
  )
})
test('Gartic: words and choices are private; public hints contain no letters', () => {
  let e = createGartic('p0', players, defaultGarticSettings, 1000)
  assert.ok(e.secrets.p0.choices.length)
  assert.equal(e.secrets.p1.choices.length, 0)
  const word = e.choices[0]
  e = moveGartic(e, 'p0', { type: 'choose', word }, 2000)
  assert.equal(e.state.phase, 'drawing')
  assert.equal(e.secrets.p0.word, word)
  assert.equal(e.secrets.p1.word, '')
  assert.ok(!JSON.stringify(e.state).includes(`"${word}"`))
  assert.ok(parseGarticState(e.state))
})
test('correct guesses ignore case/accents, give points once and never leak answer in chat', () => {
  let e = createGartic(
    'p0',
    players,
    { ...defaultGarticSettings, customWords: 'Café' },
    0,
  )
  e = moveGartic(e, 'p0', { type: 'choose', word: 'Café' }, 1000)
  e = moveGartic(e, 'p1', { type: 'guess', text: 'CAFE' }, 2000)
  assert.ok(e.state.players[1].score > 0)
  assert.equal(e.state.messages[0].text, 'Acertou!')
  assert.throws(() =>
    moveGartic(e, 'p1', { type: 'guess', text: 'café' }, 3000),
  )
  assert.throws(() =>
    moveGartic(e, 'p0', { type: 'guess', text: 'café' }, 3000),
  )
})
test('last correct guess reveals answer; timed break advances the next artist', () => {
  let e = createGartic(
    'p0',
    players.slice(0, 2),
    { ...defaultGarticSettings, rounds: 1 },
    0,
  )
  e = moveGartic(e, 'p0', { type: 'choose', word: e.choices[0] }, 1000)
  e = moveGartic(e, 'p1', { type: 'guess', text: e.word }, 2000)
  assert.equal(e.state.phase, 'roundEnd')
  assert.ok(e.state.reveal)
  e = moveGartic(e, 'p0', { type: 'tick' }, 10000)
  assert.equal(e.state.actor, 'p1')
  assert.equal(e.state.phase, 'choosing')
})
test('timeouts cannot be accelerated by a peer; all drawing turns end the match', () => {
  let e = createGartic(
    'p0',
    players.slice(0, 2),
    { ...defaultGarticSettings, rounds: 1 },
    0,
  )
  assert.throws(() => moveGartic(e, 'p1', { type: 'tick' }, 40000))
  e = moveGartic(e, 'p0', { type: 'tick' }, 50000)
  assert.equal(e.state.phase, 'drawing')
  for (let i = 0; i < 2; i++) {
    e = moveGartic(e, e.state.actor, { type: 'finish-drawing' }, 100000)
    e = moveGartic(e, e.state.actor, { type: 'next' }, 110000)
    if (e.state.phase === 'choosing')
      e = moveGartic(
        e,
        e.state.actor,
        { type: 'choose', word: e.choices[0] },
        120000,
      )
  }
  assert.equal(e.state.phase, 'finished')
})
test('telephone: initial phrase, private drawing prompt, description and final album', () => {
  let e = createGartic(
    'p0',
    players.slice(0, 3),
    { ...defaultGarticSettings, mode: 'telephone' },
    0,
  )
  assert.equal(e.state.phase, 'prompt')
  e = moveGartic(e, 'p0', { type: 'guess', text: 'Um kiwi na lua' }, 1000)
  assert.equal(e.state.phase, 'drawing')
  assert.equal(e.secrets.p1.word, 'Um kiwi na lua')
  assert.equal(e.secrets.p2.word, '')
  assert.ok(!JSON.stringify(e.state).includes('Um kiwi na lua'))
  const board = e.state.boardId
  e = moveGartic(e, 'p1', { type: 'finish-drawing' }, 2000)
  assert.equal(e.state.phase, 'guessing')
  assert.equal(e.state.boardId, board)
  assert.equal(e.state.boardArtist, 'p1')
  e = moveGartic(e, 'p2', { type: 'guess', text: 'Um astronauta verde' }, 3000)
  assert.equal(e.state.phase, 'finished')
  assert.equal(e.state.resultAlbum.length, 3)
  assert.equal(e.state.resultAlbum[0].text, 'Um kiwi na lua')
  assert.ok(parseGarticState(e.state))
})
test('optout removes players and skips an absent artist without leaving the call', () => {
  let e = createGartic('p0', players, defaultGarticSettings)
  e = moveGartic(e, 'p0', { type: 'choose', word: e.choices[0] })
  e = syncGartic(e, players.slice(1))
  assert.equal(e.state.phase, 'roundEnd')
  assert.equal(e.state.players.length, 4)
  assert.throws(() => moveGartic(e, 'p0', { type: 'guess', text: 'inválido' }))
})
test('settings and wire readers reject invalid bounds and unknown phases', () => {
  assert.equal(
    readGarticSettings({ ...defaultGarticSettings, seconds: -1 }),
    null,
  )
  assert.equal(
    readImpostorSettings({ ...defaultImpostorSettings, mode: 'leak' }),
    null,
  )
  assert.equal(parseGarticState({}), null)
  assert.equal(parseImpostorState({}), null)
})
test('the room controller advances after the drawing artist opts out, even as a spectator', () => {
  let e = createGartic('p0', players, defaultGarticSettings, 0)
  e = moveGartic(e, 'p0', { type: 'choose', word: e.choices[0] }, 1000)
  e = syncGartic(e, players.slice(1), 2000)
  assert.equal(e.state.phase, 'roundEnd')
  e = moveGartic(e, 'p0', { type: 'tick' }, 10000)
  assert.equal(e.state.phase, 'choosing')
  assert.ok(e.state.players.some((p) => p.identity === e.state.actor))
})
