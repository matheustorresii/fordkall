import { useEffect, useState } from 'react'
import { PokerStage } from '../components/Games/PokerStage'
import {
  applyPokerAction,
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
export const PokerPreview = ({
  participants,
  onOpenGameHub,
}: {
  participants: ParticipantMedia[]
  onOpenGameHub: () => void
}) => {
  const [count, setCount] = useState(6)
  const [engine, setEngine] = useState(() => fixture(participants.slice(0, 6)))
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
            <button onClick={() => setEngine({ state: emptyPokerState('p0'), hands: {}, deck: [] })} type="button">
              Lobby poker
            </button>
          </div>
        </details>
      )}
    </>
  )
}
