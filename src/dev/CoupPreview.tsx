import { useEffect, useState } from 'react'
import { CoupStage } from '../components/Games/CoupStage'
import {
  applyCoupMove,
  coupActions,
  coupResponders,
  createCoupMatch,
  defaultCoupSettings,
  emptyCoupState,
} from '../games/coup'
import type { CoupEngine, CoupMove, CoupSettings } from '../games/coup'
import type { ParticipantMedia } from '../types'

export const coupNextDecision = (engine: CoupEngine): { identity: string; move: CoupMove } | null => {
  const s = engine.state,
    p = s.pending
  if (s.phase === 'turn') {
    const who = s.players.find((p) => p.identity === s.current)!
    const target = s.players.find((p) => p.influence && p.identity !== who.identity)!
    return {
      identity: who.identity,
      move:
        who.coins >= 7
          ? { type: 'act', action: 'coup', target: target.identity }
          : { type: 'act', action: 'tax' },
    }
  }
  if (['action-response', 'block-response', 'block-challenge'].includes(s.phase)) {
    const identity = coupResponders(s)[0]
    return identity ? { identity, move: { type: 'pass' } } : null
  }
  if (s.phase === 'proof' && p) {
    const identity = p.claim === 'block' ? p.blocker : p.actor
    const proof = engine.hands[identity]?.find(
      (c) => c.role === (p.claim === 'block' ? p.blockRole : coupActions[p.action].role),
    )
    return { identity, move: proof ? { type: 'prove', cardId: proof.id } : { type: 'concede' } }
  }
  if (s.phase === 'lose-influence')
    return {
      identity: s.loss!.identity,
      move: { type: 'lose', cardId: engine.hands[s.loss!.identity]![0]!.id },
    }
  if (s.phase === 'exchange' && p)
    return { identity: p.actor, move: { type: 'exchange', keep: engine.hands[p.actor]!.map((c) => c.id) } }
  return null
}
const fixture = (participants: ParticipantMedia[]): CoupEngine => {
  const engine = createCoupMatch(
    participants.map((p) => ({ identity: p.id, name: p.name })),
    { responseSeconds: 0 },
  )
  engine.state.current = participants[0]!.id
  const me = engine.state.players[0]!
  engine.state.treasury -= 5 - me.coins
  me.coins = 5
  return engine
}
export const CoupPreview = ({
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
  const update = (change: (current: CoupEngine) => CoupEngine) => {
    try {
      setEngine(change(engine))
      setError('')
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro na prévia')
      return false
    }
  }
  useEffect(() => {
    const next = coupNextDecision(engine)
    if (!auto || !next || next.identity === localId) return
    const timer = window.setTimeout(() => setEngine((e) => applyCoupMove(e, next.identity, next.move)), 600)
    return () => window.clearTimeout(timer)
  }, [auto, engine, localId])
  const start = (settings: CoupSettings = defaultCoupSettings) =>
    update(() =>
      createCoupMatch(
        participants.slice(0, count).map((p) => ({ identity: p.id, name: p.name })),
        settings,
      ),
    )
  return (
    <>
      <CoupStage
        participants={participants.slice(0, count)}
        onExit={onOpenGameHub}
        onOpenGameHub={onOpenGameHub}
        game={{
          state: engine.state,
          hand: engine.hands[localId] ?? [],
          exchange:
            engine.state.phase === 'exchange' && engine.state.pending?.actor === localId
              ? engine.exchange
              : [],
          error,
          clearError: () => setError(''),
          participantCount: count,
          start,
          move: (move) => update((e) => applyCoupMove(e, localId, move)),
          reset: () => {
            setEngine({ state: emptyCoupState(localId), deck: [], hands: {}, exchange: [] })
            return true
          },
        }}
      />
      {!new URLSearchParams(window.location.search).has('clean') && (
        <details
          style={{
            position: 'fixed',
            bottom: 8,
            right: 8,
            zIndex: 100,
            background: '#243148ed',
            padding: 10,
            borderRadius: 10,
            font: '11px system-ui',
            color: '#eee',
          }}
        >
          <summary>Prévia do Coup</summary>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 260, paddingTop: 8 }}>
            {[2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                onClick={() => {
                  setCount(n)
                  setEngine(fixture(participants.slice(0, n)))
                }}
                type="button"
              >
                {n} pessoas
              </button>
            ))}
            <button onClick={() => setAuto(!auto)} type="button">
              {auto ? 'Pausar' : 'Simular'} rivais
            </button>
            <button
              onClick={() => setEngine({ state: emptyCoupState(localId), deck: [], hands: {}, exchange: [] })}
              type="button"
            >
              Lobby
            </button>
          </div>
        </details>
      )}
    </>
  )
}
