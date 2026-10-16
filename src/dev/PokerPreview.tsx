import { useEffect, useState } from 'react'
import { PokerStage } from '../components/Games/PokerStage'
import {
  applyPokerAction,
  advancePokerFlow,
  createPokerMatch,
  dealPokerHand,
  defaultPokerSettings,
  emptyPokerState,
  pokerLegalActions,
  type PokerEngine,
  type PokerSettings,
} from '../games/poker'
import type { ParticipantMedia } from '../types'

const random = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 0x100000000
}
const fixture = (participants: ParticipantMedia[]): PokerEngine => {
  let engine = createPokerMatch(
    participants.map((p) => ({ identity: p.id, name: p.name })),
    { ...defaultPokerSettings, turnSeconds: 0 },
    random(43),
  )
  for (let step = 0; step < 20 && (engine.state.street === 'preflop' || engine.state.current !== 'p0'); step++) {
    const legal = pokerLegalActions(engine.state, engine.state.current)
    engine = applyPokerAction(engine, engine.state.current, { type: legal.canCheck ? 'check' : 'call' })
  }
  return engine
}
const allInFixture = (participants: ParticipantMedia[]): PokerEngine => {
  let engine = createPokerMatch(participants.map((p) => ({ identity: p.id, name: p.name })), { ...defaultPokerSettings, turnSeconds: 0 }, random(43))
  while (engine.state.phase === 'playing') {
    const legal = pokerLegalActions(engine.state, engine.state.current)
    engine = applyPokerAction(engine, engine.state.current, { type: legal.canAllIn ? 'all-in' : legal.canCheck ? 'check' : 'call' })
  }
  return engine
}
const resultFixture = (participants: ParticipantMedia[]): PokerEngine => {
  let engine = createPokerMatch(participants.map((p) => ({ identity: p.id, name: p.name })), { ...defaultPokerSettings, turnSeconds: 0 }, random(43))
  while (engine.state.phase === 'playing') engine = applyPokerAction(engine, engine.state.current, { type: 'fold' })
  return engine
}
export const PokerPreview = ({
  participants,
  onOpenGameHub,
}: {
  participants: ParticipantMedia[]
  onOpenGameHub: () => void
}) => {
  const initialCount = Math.min(6, Math.max(2, Number(new URLSearchParams(window.location.search).get('players')) || 6))
  const [count, setCount] = useState(initialCount)
  const [engine, setEngine] = useState(() => fixture(participants.slice(0, initialCount)))
  const [auto, setAuto] = useState(true)
  const [error, setError] = useState('')
  const localId = participants[0]!.id
  const update = (build: (current: PokerEngine) => PokerEngine) => {
    try {
      setEngine(build(engine))
      setError('')
      return true
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      return false
    }
  }
  useEffect(() => {
    if (!auto || engine.state.phase !== 'playing' || engine.state.current === localId) return
    const timer = window.setTimeout(
      () =>
        setEngine((current) =>
          applyPokerAction(current, current.state.current, {
            type: pokerLegalActions(current.state, current.state.current).canCheck ? 'check' : 'call',
          }),
        ),
      600,
    )
    return () => window.clearTimeout(timer)
  }, [auto, engine, localId])
  useEffect(() => {
    if (!['runout', 'hand-result'].includes(engine.state.phase) || !engine.state.transitionAt) return
    const timer = window.setTimeout(() => setEngine((current) => advancePokerFlow(current)), Math.max(1, engine.state.transitionAt - Date.now() + 30))
    return () => window.clearTimeout(timer)
  }, [engine.state.phase, engine.state.transitionAt])
  const start = (settings: PokerSettings = defaultPokerSettings) =>
    update(() =>
      createPokerMatch(
        participants.slice(0, count).map((p) => ({ identity: p.id, name: p.name })),
        settings,
      ),
    )
  return (
    <>
      <PokerStage
        game={{
          state: engine.state,
          hand: engine.hands[localId] ?? [],
          error,
          clearError: () => setError(''),
          participantCount: count,
          start,
          act: (action) => update((current) => applyPokerAction(current, localId, action)),
          nextHand: () => update(dealPokerHand),
          reset: () => {
            setEngine({ state: emptyPokerState('p0'), hands: {}, deck: [] })
            return true
          },
        }}
        participants={participants.slice(0, count)}
        onExit={onOpenGameHub}
        onOpenGameHub={onOpenGameHub}
      />
      {!new URLSearchParams(window.location.search).has('clean') && (
        <details
          style={{
            position: 'fixed',
            zIndex: 100,
            bottom: 8,
            right: 8,
            padding: 8,
            borderRadius: 8,
            background: '#202733ef',
            color: '#e3ecf2',
            font: '11px system-ui',
          }}
        >
          <summary>Prévia do poker</summary>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 260, paddingTop: 8 }}>
            {[2, 3, 4, 5, 6].map((number) => (
              <button
                key={number}
                onClick={() => {
                  setCount(number)
                  setEngine(fixture(participants.slice(0, number)))
                }}
                type="button"
              >
                {number} jogadores
              </button>
            ))}
            <button onClick={() => setAuto(!auto)} type="button">
              {auto ? 'Pausar' : 'Simular'} adversários
            </button>
            <button onClick={() => setEngine(allInFixture(participants.slice(0, count)))} type="button">All-in pré-flop</button>
            <button onClick={() => setEngine(resultFixture(participants.slice(0, count)))} type="button">Resultado com intervalo</button>
            <button onClick={() => setEngine({ state: emptyPokerState('p0'), hands: {}, deck: [] })} type="button">
              Lobby poker
            </button>
          </div>
        </details>
      )}
    </>
  )
}
