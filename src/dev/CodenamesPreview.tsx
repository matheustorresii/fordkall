import { useState } from 'react'
import { CodenamesStage } from '../components/Games/CodenamesStage'
import {
  applyCodenamesMove,
  codenamesPrivateFor,
  createCodenamesMatch,
  emptyCodenamesState,
  syncCodenamesMembers,
} from '../games/codenames'
import type { CodenamesEngine, CodenamesKind, CodenamesSettings } from '../games/codenames'
import type { ParticipantMedia } from '../types'

const random = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 0x100000000
}
const lobby = (participants: ParticipantMedia[]) => {
  let engine = syncCodenamesMembers(
    { state: emptyCodenamesState('p0'), key: [] },
    participants.map((p) => ({ identity: p.id, name: p.name })),
  )
  participants.forEach((p, i) => {
    engine = applyCodenamesMove(engine, p.id, {
      type: 'seat',
      team: i % 2 ? 'blue' : 'red',
      role: i < 2 ? 'spymaster' : 'operative',
    })
  })
  return engine
}
const fixture = (participants: ParticipantMedia[], stage: string | null) => {
  let engine = lobby(participants)
  if (!stage || stage === 'lobby') return engine
  engine = createCodenamesMatch(engine.state, undefined, random(98765))
  if (stage !== 'clue') {
    const master = engine.state.players.find(
      (p) => p.team === engine.state.turnTeam && p.role === 'spymaster',
    )!
    engine = applyCodenamesMove(engine, master.identity, { type: 'clue', word: 'CONEXÃO', count: 3 })
    if (stage === 'midgame' || stage === 'finished') {
      const agent = engine.state.players.find(
        (p) => p.team === engine.state.turnTeam && p.role === 'operative',
      )!
      const at = engine.key.findIndex(
        (k) => k === (stage === 'finished' ? 'assassin' : engine.state.turnTeam),
      )
      engine = applyCodenamesMove(engine, agent.identity, {
        type: 'guess',
        cardId: engine.state.board[at]!.id,
      })
    }
  }
  return engine
}
export const CodenamesPreview = ({
  participants,
  onOpenGameHub,
}: {
  participants: ParticipantMedia[]
  onOpenGameHub: () => void
}) => {
  const all = Array.from(
    { length: 12 },
    (_, i) =>
      participants[i] ?? { ...participants[0]!, id: `p${i}`, name: `Pessoa ${i + 1}`, isLocal: false },
  )
  const query = new URLSearchParams(window.location.search)
  const initialCount = [4, 6, 8, 12].includes(Number(query.get('players'))) ? Number(query.get('players')) : 6
  const [count, setCount] = useState(initialCount),
    [view, setView] = useState(
      all.slice(0, initialCount).some((p) => p.id === query.get('view')) ? query.get('view')! : 'p0',
    )
  const [engine, setEngine] = useState<CodenamesEngine>(() =>
    fixture(all.slice(0, initialCount), query.get('stage')),
  )
  const [error, setError] = useState('')
  const people = all.slice(0, count).map((p) => ({ ...p, isLocal: p.id === view }))
  const update = (build: (e: CodenamesEngine) => CodenamesEngine) => {
    try {
      setEngine(build(engine))
      setError('')
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    }
  }
  const start = (settings?: CodenamesSettings) =>
    update((e) => createCodenamesMatch(e.state, settings, random(98765)))
  const exampleClue = () =>
    update((e) =>
      applyCodenamesMove(
        e,
        e.state.players.find((p) => p.team === e.state.turnTeam && p.role === 'spymaster')!.identity,
        { type: 'clue', word: 'CONEXÃO', count: 3 },
      ),
    )
  const reveal = (kind: CodenamesKind) =>
    update((e) => {
      const who = e.state.players.find((p) => p.team === e.state.turnTeam && p.role === 'operative')!
      const index = e.state.board.findIndex((c, i) => !c.revealed && e.key[i] === kind)
      return applyCodenamesMove(e, who.identity, { type: 'guess', cardId: e.state.board[index]!.id })
    })
  return (
    <>
      <CodenamesStage
        game={{
          state: engine.state,
          key: codenamesPrivateFor(engine, view).key,
          error,
          clearError: () => setError(''),
          start,
          move: (move) => update((e) => applyCodenamesMove(e, view, move)),
          reset: () => update(() => lobby(all.slice(0, count))),
        }}
        participants={people}
        onExit={onOpenGameHub}
        onOpenGameHub={onOpenGameHub}
      />
      {!new URLSearchParams(window.location.search).has('clean') && (
        <details
          style={{
            position: 'fixed',
            bottom: 8,
            right: 8,
            zIndex: 100,
            maxWidth: 310,
            padding: 9,
            borderRadius: 10,
            background: '#18232ff5',
            color: '#dce8ee',
            font: '11px system-ui',
          }}
        >
          <summary>Prévia Codenames</summary>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 10 }}>
            <label>
              Perspectiva{' '}
              <select
                aria-label="Perspectiva da prévia"
                value={view}
                onChange={(e) => setView(e.target.value)}
              >
                {all.slice(0, count).map((p, i) => (
                  <option value={p.id} key={p.id}>
                    {p.name} · {i < 2 ? 'mestre' : 'agente'} {i % 2 ? 'azul' : 'vermelho'}
                  </option>
                ))}
              </select>
            </label>
            {[4, 6, 8, 12].map((n) => (
              <button
                key={n}
                onClick={() => {
                  setCount(n)
                  setView('p0')
                  setEngine(lobby(all.slice(0, n)))
                  setError('')
                }}
                type="button"
              >
                {n} pessoas
              </button>
            ))}
            <button type="button" onClick={() => start()}>
              Iniciar prévia
            </button>
            <button type="button" onClick={() => update(() => lobby(all.slice(0, count)))}>
              Lobby
            </button>
            <button type="button" onClick={exampleClue} disabled={engine.state.phase !== 'clue'}>
              Pista de exemplo
            </button>
            <button
              type="button"
              onClick={() => reveal(engine.state.turnTeam)}
              disabled={engine.state.phase !== 'guess'}
            >
              Agente correto
            </button>
            <button type="button" onClick={() => reveal('neutral')} disabled={engine.state.phase !== 'guess'}>
              Civil
            </button>
            <button
              type="button"
              onClick={() => reveal('assassin')}
              disabled={engine.state.phase !== 'guess'}
            >
              Assassino
            </button>
          </div>
        </details>
      )}
    </>
  )
}
